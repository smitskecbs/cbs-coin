<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>CBS Jungle Monkey</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>

  <style>
    :root{
      --bg1:#0a1210;
      --bg2:#041807;
      --fg:#fefbe8;
      --ground:#3b2613;
      --grass:#1f6b26;
      --monkey-body:#c46b32;
      --monkey-face:#f1c58a;
    }

    *{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%}
    body{
      background:radial-gradient(circle at top,#144b2a 0,#020b08 55%,#000 100%);
      display:flex;
      align-items:center;
      justify-content:center;
      font-family:system-ui, sans-serif;
      color:var(--fg);
    }

    .wrap{
      display:flex;
      flex-direction:column;
      align-items:center;
      gap:8px;
    }

    canvas{
      image-rendering:pixelated;
      image-rendering:crisp-edges;
      width:960px;   /* 320x3 */
      height:540px;  /* 180x3 */
      border-radius:12px;
      border:2px solid #2cff9b33;
      box-shadow:0 0 40px rgba(0,0,0,.9),0 0 24px rgba(47,255,155,.25);
      background:#000;
    }

    .hud{
      text-align:center;
      font-size:14px;
      color:#d9fdd2;
    }
    .hud b{color:#9dff7a}
  </style>
</head>
<body>
  <div class="wrap">
    <canvas id="game" width="320" height="180"></canvas>
    <div class="hud">
      <div>Controls: <b>← →</b> / <b>A D</b> lopen – <b>↑</b> of <b>SPACE</b> springen</div>
      <div>Doel: loop naar rechts, spring over gaten en platforms in de jungle 🐒🌴</div>
    </div>
  </div>

  <script>
    const canvas = document.getElementById("game");
    const ctx    = canvas.getContext("2d");

    // ===== Wereld instellingen =====
    const TILE_SIZE = 16;         // 16x16 pixel tiles
    const WORLD_WIDTH  = 200;     // aantal tiles breed
    const WORLD_HEIGHT = 12;      // aantal tiles hoog

    // Tegel types
    const TILE_EMPTY   = 0;
    const TILE_GROUND  = 1;
    const TILE_GRASS   = 2;

    // Maak eenvoudige tilemap (grond + paar platforms)
    const world = [];
    for(let y=0;y<WORLD_HEIGHT;y++){
      world[y] = [];
      for(let x=0;x<WORLD_WIDTH;x++){
        // standaard lucht
        world[y][x] = TILE_EMPTY;
      }
    }

    // ondergrond (bodem) als grond + gras-laag
    const GROUND_LEVEL = WORLD_HEIGHT - 2;
    for(let x=0;x<WORLD_WIDTH;x++){
      world[GROUND_LEVEL][x]   = TILE_GRASS;
      world[GROUND_LEVEL+1][x] = TILE_GROUND;
    }

    // paar gaten in de grond
    function carveHole(startX, width){
      for(let x=startX;x<startX+width;x++){
        world[GROUND_LEVEL][x]   = TILE_EMPTY;
        world[GROUND_LEVEL+1][x] = TILE_EMPTY;
      }
    }
    carveHole(18,3);
    carveHole(40,4);
    carveHole(70,3);

    // simpele platformen
    function addPlatform(x,y,length){
      for(let i=0;i<length;i++){
        world[y][x+i] = TILE_GRASS;
      }
    }
    addPlatform(12, GROUND_LEVEL-3, 4);
    addPlatform(28, GROUND_LEVEL-5, 6);
    addPlatform(55, GROUND_LEVEL-4, 4);
    addPlatform(90, GROUND_LEVEL-6, 6);

    // ===== Aapje / speler =====
    const player = {
      x: 5 * TILE_SIZE,
      y: (GROUND_LEVEL-1) * TILE_SIZE,
      vx: 0,
      vy: 0,
      w: 12,
      h: 14,
      onGround: false
    };

    const GRAVITY      = 800;
    const MOVE_SPEED   = 140;
    const JUMP_VELOCITY= -280;
    const MAX_FALL     = 600;
    const FRICTION     = 0.80;

    // camera
    let cameraX = 0;

    // input
    const keys = {};
    window.addEventListener("keydown", e=>{
      keys[e.key.toLowerCase()] = true;
    });
    window.addEventListener("keyup", e=>{
      keys[e.key.toLowerCase()] = false;
    });

    function isSolidTile(tx,ty){
      if(tx<0 || ty<0 || tx>=WORLD_WIDTH || ty>=WORLD_HEIGHT) return false;
      const t = world[ty][tx];
      return t === TILE_GROUND || t === TILE_GRASS;
    }

    // AABB collision met tiles
    function moveAndCollide(dt){
      // horizontale beweging
      player.x += player.vx * dt;

      // horizontale collision
      const left   = Math.floor(player.x / TILE_SIZE);
      const right  = Math.floor((player.x + player.w) / TILE_SIZE);
      const top    = Math.floor(player.y / TILE_SIZE);
      const bottom = Math.floor((player.y + player.h) / TILE_SIZE);

      if(player.vx > 0){
        // check rechts
        for(let ty = top; ty <= bottom; ty++){
          if(isSolidTile(right, ty)){
            player.x = right * TILE_SIZE - player.w - 0.01;
            player.vx = 0;
            break;
          }
        }
      }else if(player.vx < 0){
        // check links
        for(let ty = top; ty <= bottom; ty++){
          if(isSolidTile(left, ty)){
            player.x = (left+1) * TILE_SIZE + 0.01;
            player.vx = 0;
            break;
          }
        }
      }

      // verticale beweging
      player.vy += GRAVITY * dt;
      if(player.vy > MAX_FALL) player.vy = MAX_FALL;
      player.y += player.vy * dt;

      let newTop    = Math.floor(player.y / TILE_SIZE);
      let newBottom = Math.floor((player.y + player.h) / TILE_SIZE);
      let newLeft   = Math.floor(player.x / TILE_SIZE);
      let newRight  = Math.floor((player.x + player.w) / TILE_SIZE);

      player.onGround = false;

      if(player.vy > 0){
        // omlaag
        for(let tx=newLeft; tx<=newRight; tx++){
          if(isSolidTile(tx,newBottom)){
            player.y = newBottom*TILE_SIZE - player.h - 0.01;
            player.vy = 0;
            player.onGround = true;
            break;
          }
        }
      }else if(player.vy < 0){
        // omhoog
        for(let tx=newLeft; tx<=newRight; tx++){
          if(isSolidTile(tx,newTop)){
            player.y = (newTop+1)*TILE_SIZE + 0.01;
            player.vy = 0;
            break;
          }
        }
      }

      // als speler uit beeld valt → respawn
      if(player.y > canvas.height + 200){
        player.x = 5 * TILE_SIZE;
        player.y = (GROUND_LEVEL-1)*TILE_SIZE;
        player.vx = 0;
        player.vy = 0;
        cameraX = 0;
      }
    }

    function update(dt){
      // links/rechts input
      let move = 0;
      if(keys["arrowleft"] || keys["a"]) move -= 1;
      if(keys["arrowright"]|| keys["d"]) move += 1;
      player.vx = move * MOVE_SPEED;

      // jump
      if((keys["arrowup"] || keys[" "]) && player.onGround){
        player.vy = JUMP_VELOCITY;
        player.onGround = false;
      }

      moveAndCollide(dt);

      // camera volgt speler
      const targetCam = player.x - canvas.width/2 + player.w/2;
      cameraX += (targetCam - cameraX) * 0.15;
      if(cameraX < 0) cameraX = 0;
      const maxCam = WORLD_WIDTH*TILE_SIZE - canvas.width;
      if(cameraX > maxCam) cameraX = maxCam;
    }

    // ===== TEKENEN =====
    function drawBackground(){
      // lucht
      const grad = ctx.createLinearGradient(0,0,0,canvas.height);
      grad.addColorStop(0,"#062019");
      grad.addColorStop(0.5,"#04140f");
      grad.addColorStop(1,"#020706");
      ctx.fillStyle = grad;
      ctx.fillRect(0,0,canvas.width,canvas.height);

      // vage bomen lagen
      for(let i=0;i<3;i++){
        const yBase = 60 + i*25;
        ctx.fillStyle = `rgba(10,40,20,${0.35 - i*0.08})`;
        for(let x=-1;x<20;x++){
          const treeX = x*40 - (cameraX*0.2) % 40 + i*10;
          const w = 24;
          const h = 50 + i*15;
          ctx.fillRect(treeX, yBase, w, h);
        }
      }
    }

    function drawTiles(){
      const startTileX = Math.floor(cameraX / TILE_SIZE);
      const endTileX   = Math.ceil((cameraX + canvas.width) / TILE_SIZE);

      for(let y=0;y<WORLD_HEIGHT;y++){
        for(let x=startTileX;x<endTileX;x++){
          if(x<0 || x>=WORLD_WIDTH) continue;
          const t = world[y][x];
          if(t === TILE_EMPTY) continue;

          const screenX = x*TILE_SIZE - cameraX;
          const screenY = y*TILE_SIZE;

          if(t === TILE_GROUND){
            ctx.fillStyle = "#2c1a0b";
            ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = "#1b1006";
            ctx.fillRect(screenX, screenY+10, TILE_SIZE, 6);
          }else if(t === TILE_GRASS){
            ctx.fillStyle = "#215c22";
            ctx.fillRect(screenX, screenY+4, TILE_SIZE, TILE_SIZE-4);
            ctx.fillStyle = "#3aa52e";
            ctx.fillRect(screenX, screenY, TILE_SIZE, 6);
            ctx.fillStyle = "#62d34a";
            ctx.fillRect(screenX, screenY, TILE_SIZE, 2);
          }
        }
      }
    }

    function drawMonkey(){
      const sx = Math.floor(player.x - cameraX);
      const sy = Math.floor(player.y);

      // monky body
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#c46b32";
      ctx.fillRect(sx, sy+3, 12, 11);    // lijf
      ctx.fillRect(sx+2, sy, 8, 7);      // hoofd
      ctx.fillStyle = "#f1c58a";
      ctx.fillRect(sx+3, sy+2, 5, 4);    // gezicht
      ctx.fillStyle = "#5b3416";
      ctx.fillRect(sx+1, sy+4, 1, 3);    // oor links
      ctx.fillRect(sx+10,sy+4, 1, 3);    // oor rechts

      // staart
      ctx.fillRect(sx-2, sy+6, 2, 2);
      ctx.fillRect(sx-2, sy+4, 2, 2);

      // oogjes
      ctx.fillStyle = "#000";
      ctx.fillRect(sx+4, sy+3, 1,1);
      ctx.fillRect(sx+7, sy+3, 1,1);

      // benen (klein)
      ctx.fillStyle = "#8a451f";
      ctx.fillRect(sx+3, sy+14, 2,2);
      ctx.fillRect(sx+7, sy+14, 2,2);

      ctx.restore();
    }

    function draw(dt){
      drawBackground();
      drawTiles();
      drawMonkey();
    }

    // ===== LOOP =====
    let lastTime = 0;
    function loop(ts){
      if(!lastTime) lastTime = ts;
      const dt = Math.min(0.033, (ts-lastTime)/1000);
      lastTime = ts;

      update(dt);
      draw(dt);
      requestAnimationFrame(loop);
    }

    // start gelijk loop, maar speler staat stil tot je beweegt
    requestAnimationFrame(loop);

    // start-knop reset speler & camera
    startBtn.addEventListener("click", ()=>{
      player.x = 5*TILE_SIZE;
      player.y = (GROUND_LEVEL-1)*TILE_SIZE;
      player.vx = 0;
      player.vy = 0;
      cameraX = 0;
    });
  </script>
</body>
</html>
