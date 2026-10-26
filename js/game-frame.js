(()=>{
const betaFrame=document.getElementById("gameBetaFrame");
// Tells the lobby whether the Game page is showing, so it only polls the server while you can see it.
const tellFrame=()=>betaFrame?.contentWindow?.postMessage({kind:"glep-game-page",shown:document.body.dataset.page==="game"},location.origin);
new MutationObserver(tellFrame).observe(document.body,{attributes:true,attributeFilter:["data-page"]});
betaFrame?.addEventListener("load",tellFrame);
window.addEventListener("message",event=>{
 if(event.origin!==location.origin||event.source!==betaFrame?.contentWindow||event.data?.kind!=="glep-beta-size")return;
 const height=Number(event.data.height);if(Number.isFinite(height)&&height>=200&&height<=20000)betaFrame.style.height=Math.ceil(height)+"px";
});
})();
