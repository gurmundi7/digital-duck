// Is the owner on a call? Either signal says yes:
//   screen   a call app is the frontmost window
//   mic      another app holds the mic open (calls do, even muted); the duck's own push-to-talk does not count
const CALL_APPS = /zoom\.us|Google Meet|FaceTime|Microsoft Teams|Webex|Around|Tuple/i;

function callReasons({ frontOwner, micBusy, duckListening }) {
  const why = [];
  if (frontOwner && CALL_APPS.test(frontOwner)) why.push("screen");
  if (micBusy && !duckListening) why.push("mic");
  return why;
}

module.exports = { CALL_APPS, callReasons };
