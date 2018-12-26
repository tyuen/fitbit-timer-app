import clock from "clock";
import document from "document";
import {preferences} from "user-settings";
import {me} from "appbit";
import {display} from "display";
import {vibration} from "haptics";
import fs from "fs";

const $ = id => document.getElementById(id);
const pad = n => n < 10 ? "0" + n : n;

const HOUR12 = (preferences.clockDisplay === "12h");

const mainNode = $("main");
const touchNode = $("touch");

const dragBoxNode = $("drag-box");
const dragTimeNode = $("drag-time");
const countTimeNode = $("count-time");

const startTimeNode = $("start-time");
const nowTimeNode = $("now-time");
const endTimeNode = $("end-time");

const btnNode = $("cancel-btn");

clock.granularity = "seconds";

me.appTimeoutEnabled = false;  //SDK2.0

const WIDTH = mainNode.width;

let isTouchDown = false;

let startTime = 0;
let endTime = 0;

let readPopup = false;  //whether user read the "silent mode" popup

let isRung = false;  //whether vibration.start() was already called once

function init() {
  try {
    let obj = fs.readFileSync("settings.txt", "cbor");
    startTime = obj.startTime;
    endTime = obj.endTime;
    readPopup = obj.readPopup;
  } catch(e) {}

  //display the previous timer result if it occured within 5 minutes ago
  if(endTime > 0 && Date.now() < endTime + 300000) {
    setNodeToTime(startTimeNode, startTime);
    setNodeToTime(endTimeNode, endTime);
    btnNode.style.display = "inline";
  } else {
    //show a bit of the drag bar as an affordance of user interaction
    dragBoxNode.width = 2;
  }
}

init();

function setNodeToTime(node, t) {
  let d = new Date(t);
  let hour = d.getHours();
  if(HOUR12 && hour > 12) hour %= 12;
  node.text = hour + ":" + pad(d.getMinutes());
}

let mouseDownStart = 0;  //used to distinguish between down+up and down+drag

touchNode.onmousedown = e => {
  let now = Date.now();
  if(startTime === 0 || now < startTime + 6000 || now > endTime) {
    isTouchDown = true;

    clearTimeout(lingerTimer);
    lingerNum = 0;
    curNum = 0;

    startTime = 0;
    endTime = 0;

    dragTimeNode.text = "0";
    countTimeNode.text = "m";
    startTimeNode.text = "";
    endTimeNode.text = "";
    isRung = false;

    btnNode.style.display = "none";  //hide X button

    dragBoxNode.width = 0;
    dragBoxNode.animate("enable");
  }
  vibration.stop();  //so the user can turn off an active buzzer with a tap
  mouseDownStart = now;
};

const PI_WIDTH = Math.PI/((WIDTH - 10)*4);

let curNum = 0;
let lingerNum = 0;
let lingerTimer = 0;

touchNode.onmousemove = e => {
  if(isTouchDown && Date.now() - mouseDownStart > 200) {
    let x = Math.min(WIDTH - 10, Math.max(0, e.screenX - 5));
    dragBoxNode.width = x;

    curNum = Math.round(60*Math.tan(x*PI_WIDTH));
    dragTimeNode.text = curNum;

    if(curNum !== lingerNum) {
      clearTimeout(lingerTimer);
      //linger timer used to avoid the user's selection from
      //changing when they lift their finger off the screen
      lingerTimer = setTimeout(() => {
        lingerNum = curNum;
      }, 80);
    }
  }
};

touchNode.onmouseup = e => {
  if(isTouchDown) {
    isTouchDown = false;
    clearTimeout(lingerTimer);
    dragBoxNode.animate("disable");

    if(lingerNum > 0 && Math.abs(lingerNum - curNum) < 4) {
      curNum = lingerNum;
      dragTimeNode.text = curNum;
    }

    if(curNum > 0) {
      startTime = Date.now();
      setNodeToTime(startTimeNode, startTime)
      endTime = startTime + curNum*60000;
      setNodeToTime(endTimeNode, endTime);
      btnNode.style.display = "inline";

    } else {
      startTime = endTime = 0;
      dragTimeNode.text = 0;
      startTimeNode.text = "";
      endTimeNode.text = "";
      btnNode.style.display = "none";
      //show a bit of the drag bar as an affordance of user interaction
      dragBoxNode.width = 2;
    }

    checkAndAdjust();
  }
};

me.onunload = () => {
  fs.writeFileSync("settings.txt", {startTime, endTime, readPopup}, "cbor");   
};

let adjustTimer;

//checkAndAdjust is used to maintain time since
//we cannot rely on clock.ontick() which doesn't get
//called when the screen is off.
function checkAndAdjust() {
  clearTimeout(adjustTimer);
  let diff = endTime - Date.now();
  if(diff > 0) {
    if(diff > 30000) {
      //don't set a timer for more than 30s (arbitrary) in case
      //the clock queue is inaccurate or incase it is GC'ed.
      setTimeout(checkAndAdjust, 30000);
    } else if(diff > 15000) {
      setTimeout(checkAndAdjust, diff - 15000);
    } else {
      display.poke();  //poke screen every second so that clock.ontick() is called
      setTimeout(checkAndAdjust, 1000);      
    }
  }
}

clock.ontick = e => {
  let now = e.date.getTime();
  setNodeToTime(nowTimeNode, now);

  if(endTime > 0) {
    if(now >= endTime && now - endTime < 10000) {
      //buzz
      dragTimeNode.text = "0";
      countTimeNode.text = "now";
      if(!isRung) {
        isRung = true;
        vibration.start("ring");
      }
      btnNode.style.display = "none";

    } else if(now - startTime <= 1000) {
      //keep the user's selection visible for 1 second (1 cycle)

    } else if(now < endTime) {
      let t = endTime - now;
      let mins = Math.floor(t/60000);
      dragTimeNode.text = mins;
      t %= 60000;
      countTimeNode.text = mins + ":" + pad(Math.floor(t/1000));
    }
  }
};

//the "X" button to reset the timer
btnNode.onclick = () => {
  startTime = 0;
  endTime = 0;
  dragTimeNode.text = "0";
  countTimeNode.text = "m";
  startTimeNode.text = "";
  endTimeNode.text = "";
  isRung = false;
  btnNode.style.display = "none";
  checkAndAdjust();  //clears any timeouts
};

//the "silent mode" button on the warning dialog
$("silent-btn").onclick = () => {
  readPopup = true;
  $("warn").style.display = "none";
};

let triedExit = false;
document.onkeypress = e => {
  if(e && e.key === "back" && !triedExit && startTime > 0) {
    triedExit = true;
    if(!readPopup) {
      $("warn").style.display = "inline";
      e.preventDefault();
    }
  }
};
