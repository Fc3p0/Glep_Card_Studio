(()=>{
const betaFrame=document.getElementById("gameBetaFrame");
window.addEventListener("message",event=>{
 if(event.origin!==location.origin||event.source!==betaFrame?.contentWindow||event.data?.kind!=="glep-beta-size")return;
 const height=Number(event.data.height);if(Number.isFinite(height)&&height>=200&&height<=20000)betaFrame.style.height=Math.ceil(height)+"px";
});
})();
