// Game Variables & Scene Setup
let scene, camera, renderer, clock;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let isCrouching = false;
let canJump = false;
let velocity = new THREE.Vector3();

// Player Controls & Stats
let playerHeight = 1.62; 
let targetPlayerHeight = 1.62;
let isLocked = false;
let pitch = 0, yaw = 0;
let myHealth = 100;
let myKills = 0;
let myDeaths = 0;
let matchTimerString = "10:00";
let isDeadLocal = false;
let playerName = "Player";
let gameStarted = false;

// Head Bobbing & Animation Variables
let headBobTimer = 0;
const bobFrequency = 10;
const bobAmplitude = 0.05;
let playerWalkTimer = 0;

// Game Objects
let targets = [];
let bloodParticles = [];
let gun, muzzleFlash;
let isShooting = false;
let recoilTimer = 0;
let localPlayerParts = null; 

// Multiplayer Setup
const socket = io();
const otherPlayers = {};

// Mobile Touch Control Variables
let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

init();
animate();
initNamePrompt();

function initNamePrompt() {
    const overlay = document.createElement('div');
    overlay.id = 'name-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0, 0, 0, 0.85)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '9999';

    overlay.innerHTML = `
        <div style="background: #222; padding: 30px; border-radius: 10px; border: 2px solid #00a8b5; text-align: center; color: white; font-family: monospace;">
            <h2>BLOCK FPS MULTIPLAYER</h2>
            <p style="margin: 15px 0 10px 0; font-size: 14px; color: #aaa;">Type ur name (Player/User):</p>
            <input type="text" id="player-name-input" placeholder="Enter name..." value="Player_${Math.floor(Math.random()*1000)}" style="padding: 10px; font-size: 16px; width: 220px; text-align: center; background: #111; color: white; border: 1px solid #555; border-radius: 5px; outline: none;">
            <br><br>
            <button id="join-btn" style="padding: 10px 25px; font-size: 16px; font-weight: bold; background: #00a8b5; color: white; border: none; border-radius: 5px; cursor: pointer;">JOIN GAME</button>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('join-btn').addEventListener('click', startGame);
    document.getElementById('player-name-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') startGame();
    });
}

function startGame() {
    const input = document.getElementById('player-name-input');
    if (input && input.value.trim() !== '') {
        playerName = input.value.trim();
    }
    
    const overlay = document.getElementById('name-overlay');
    if (overlay) overlay.remove();

    gameStarted = true;
    socket.emit('setPlayerName', playerName);
    updateHUD();

    if (isMobile) {
        setupMobileControls();
        isLocked = true;
    } else {
        const blocker = document.getElementById('blocker');
        if (blocker) {
            blocker.style.display = 'flex';
        } else {
            document.body.requestPointerLock();
        }
    }
}

function init() {
    clock = new THREE.Clock();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 0, 250);

    camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, playerHeight, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    scene.add(dirLight);

    createMap();
    createGun();

    if (!isMobile) {
        setupPointerLock();
    }

    window.addEventListener('resize', onWindowResize);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', (e) => { if (!isMobile) shoot(e); });

    // Multiplayer Socket Listeners
    socket.on('currentPlayers', (serverPlayers) => {
        Object.keys(serverPlayers).forEach((id) => {
            if (id === socket.id) return;
            createOtherPlayerMesh(id, serverPlayers[id]);
        });
    });

    socket.on('newPlayer', (data) => {
        createOtherPlayerMesh(data.id, data.player);
    });

    socket.on('gameNotification', (msg) => {
        showGameNotification(msg);
    });

    // 🌟 Timer update listener from server
    socket.on('timerUpdate', (totalSeconds) => {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        matchTimerString = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        updateHUD();
    });

    // 🌟 Stats update listener (Kills & Deaths sync)
    socket.on('playerStatsUpdate', (data) => {
        if (data.targetId === socket.id) {
            myDeaths = data.targetDeaths;
        }
        if (data.attackerId === socket.id) {
            myKills = data.attackerKills;
        }
        updateHUD();
    });

    socket.on('playerMoved', (data) => {
        if (otherPlayers[data.id]) {
            const p = otherPlayers[data.id];
            if (p.isDead) return;
            
            const targetY = data.player.isCrouching ? (data.player.y - 2.1) : (data.player.y - 1.62);
            p.mesh.position.set(data.player.x, targetY, data.player.z);
            p.mesh.rotation.y = data.player.yaw;

            if (p.nameTag) {
                p.nameTag.position.set(data.player.x, targetY + 2.4, data.player.z);
            }

            if (data.player.isCrouching) {
                p.leftLeg.rotation.x = 0.5;
                p.rightLeg.rotation.x = 0.5;
                p.body.position.y = 0.9;
                p.head.position.y = 1.4;
            } else {
                p.body.position.y = 1.125;
                p.head.position.y = 1.75;

                if (data.player.isMoving) {
                    p.walkTimer += 0.15;
                    const angle = Math.sin(p.walkTimer) * 0.6;
                    p.leftLeg.rotation.x = angle;
                    p.rightLeg.rotation.x = -angle;
                    p.leftArm.rotation.x = -angle;
                } else {
                    p.walkTimer = 0;
                    p.leftLeg.rotation.x += (0 - p.leftLeg.rotation.x) * 0.2;
                    p.rightLeg.rotation.x += (0 - p.rightLeg.rotation.x) * 0.2;
                    p.leftArm.rotation.x += (0 - p.leftArm.rotation.x) * 0.2;
                }
            }
        }
    });

    socket.on('spawnBlood', (pos) => {
        spawnBloodSplatter(pos);
    });

    socket.on('playerDied', (data) => {
        if (data.id === socket.id) {
            isDeadLocal = true;
            myHealth = 0;
            camera.position.y = 0.4;
            showRespawnScreen(3);
        }
        if (otherPlayers[data.id]) {
            const p = otherPlayers[data.id];
            p.isDead = true;
            p.mesh.position.y = 0.2;
            p.mesh.rotation.x = Math.PI / 2.2;
            p.mesh.rotation.z = 0.3;
            if (p.nameTag) p.nameTag.position.y = 1.0;
        }
    });

    socket.on('playerRespawned', (data) => {
        if (data.id === socket.id) {
            isDeadLocal = false;
            myHealth = 100;
            hideRespawnScreen();
            camera.position.set(data.player.x, playerHeight, data.player.z);
        }
        if (otherPlayers[data.id]) {
            const p = otherPlayers[data.id];
            p.isDead = false;
            p.mesh.rotation.set(0, 0, 0);
            p.mesh.position.set(data.player.x, data.player.y - 1.62, data.player.z);
            p.mesh.traverse((child) => {
                if (child.isMesh && child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.opacity = 1.0);
                    } else {
                        child.material.opacity = 1.0;
                    }
                }
            });
            if (p.nameTag) p.nameTag.position.set(data.player.x, data.player.y + 0.8, data.player.z);
        }
    });

    socket.on('playerHealthUpdate', (data) => {
        if (data.id === socket.id) {
            myHealth = data.health;
            updateHUD();
        }
    });

    socket.on('playerDisconnect', (id) => {
        if (otherPlayers[id]) {
            const mesh = otherPlayers[id].mesh;
            scene.remove(mesh);
            if (otherPlayers[id].nameTag) {
                scene.remove(otherPlayers[id].nameTag);
            }
            const meshParts = [];
            mesh.traverse(child => { if (child.isMesh) meshParts.push(child); });
            targets = targets.filter(t => !meshParts.includes(t));
            delete otherPlayers[id];
        }
    });
}

function updateHUD() {
    let hud = document.getElementById('hud');
    if (!hud) {
        hud = document.createElement('div');
        hud.id = 'hud';
        hud.style.position = 'absolute';
        hud.style.top = '20px';
        hud.style.left = '20px';
        hud.style.color = 'white';
        hud.style.fontFamily = 'monospace';
        hud.style.fontSize = '16px';
        hud.style.fontWeight = 'bold';
        hud.style.textShadow = '2px 2px black';
        hud.style.zIndex = '100';
        document.body.appendChild(hud);
    }
    
    // K/D Ratio calculation
    const kdRatio = myDeaths === 0 ? myKills.toFixed(2) : (myKills / myDeaths).toFixed(2);

    hud.innerHTML = `TIME: ${matchTimerString} | PLAYER: ${playerName}<br>` +
                    `KILLS: ${myKills} | DEATHS: ${myDeaths} | K/D: ${kdRatio}<br>` +
                    `HEALTH: ${myHealth} | AMMO: 30 / 30`;
}

function showGameNotification(message) {
    let notif = document.getElementById('game-notif');
    if (!notif) {
        notif = document.createElement('div');
        notif.id = 'game-notif';
        notif.style.position = 'absolute';
        notif.style.top = '80px';
        notif.style.left = '50%';
        notif.style.transform = 'translateX(-50%)';
        notif.style.background = 'rgba(0, 0, 0, 0.6)';
        notif.style.color = '#00ffcc';
        notif.style.padding = '8px 16px';
        notif.style.borderRadius = '5px';
        notif.style.fontFamily = 'monospace';
        notif.style.fontSize = '14px';
        notif.style.fontWeight = 'bold';
        notif.style.zIndex = '100';
        document.body.appendChild(notif);
    }
    notif.innerText = message;
    notif.style.opacity = '1';

    setTimeout(() => {
        notif.style.opacity = '0';
    }, 3500);
}

function createNameTag(name) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(1.2, 0.3, 1);
    return sprite;
}

function showRespawnScreen(secondsLeft) {
    let respawnDiv = document.getElementById('respawn-screen');
    if (!respawnDiv) {
        respawnDiv = document.createElement('div');
        respawnDiv.id = 'respawn-screen';
        respawnDiv.style.position = 'absolute';
        respawnDiv.style.top = '50%';
        respawnDiv.style.left = '50%';
        respawnDiv.style.transform = 'translate(-50%, -50%)';
        respawnDiv.style.color = 'red';
        respawnDiv.style.fontFamily = 'monospace';
        respawnDiv.style.fontSize = '36px';
        respawnDiv.style.fontWeight = 'bold';
        respawnDiv.style.textShadow = '2px 2px black';
        respawnDiv.style.zIndex = '1000';
        respawnDiv.style.transition = 'opacity 0.5s ease';
        respawnDiv.style.opacity = '1';
        document.body.appendChild(respawnDiv);
    }

    if (secondsLeft <= 0) {
        hideRespawnScreen();
        return;
    }

    respawnDiv.innerText = `YOU DIED! Respawning in ${secondsLeft}s...`;

    setTimeout(() => {
        showRespawnScreen(secondsLeft - 1);
    }, 1000);
}

function hideRespawnScreen() {
    const respawnDiv = document.getElementById('respawn-screen');
    if (respawnDiv) {
        respawnDiv.style.opacity = '0';
        setTimeout(() => {
            respawnDiv.remove();
        }, 500);
    }
    updateHUD();
}

function spawnBloodSplatter(pos) {
    const particleCount = 12;
    const geometry = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });

    for (let i = 0; i < particleCount; i++) {
        const particle = new THREE.Mesh(geometry, material);
        particle.position.set(pos.x, pos.y + 1.2, pos.z);

        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 6,
            Math.random() * 5 + 2,
            (Math.random() - 0.5) * 6
        );

        scene.add(particle);
        bloodParticles.push({ mesh: particle, velocity: velocity, life: 0.5 });
    }
}

function createSteveHeadMaterials() {
    const hairColor = '#3b2416';
    const hairDarkColor = '#2d1a0e';
    const skinColor = '#c68642';
    const skinDarkColor = '#ad6f32';
    const eyeWhite = '#ffffff';
    const eyeBlue = '#3b3b9b';
    const mouthColor = '#4a2511';

    function makeFaceCanvas(drawFn) {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = hairColor;
        ctx.fillRect(0, 0, 64, 64);
        drawFn(ctx);
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        return new THREE.MeshStandardMaterial({ map: texture, transparent: true });
    }

    const matRight = makeFaceCanvas((ctx) => {
        ctx.fillStyle = skinColor;
        ctx.fillRect(0, 24, 64, 40);
        ctx.fillStyle = hairColor;
        ctx.fillRect(0, 0, 64, 24);
        ctx.fillRect(32, 24, 32, 16);
    });

    const matLeft = makeFaceCanvas((ctx) => {
        ctx.fillStyle = skinColor;
        ctx.fillRect(0, 24, 64, 40);
        ctx.fillStyle = hairColor;
        ctx.fillRect(0, 0, 64, 24);
        ctx.fillRect(0, 24, 32, 16);
    });

    const matTop = makeFaceCanvas((ctx) => {
        ctx.fillStyle = hairColor;
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = hairDarkColor;
        ctx.fillRect(16, 16, 32, 32);
    });

    const matBottom = makeFaceCanvas((ctx) => {
        ctx.fillStyle = skinDarkColor;
        ctx.fillRect(0, 0, 64, 64);
    });

    const matFront = makeFaceCanvas((ctx) => {
        ctx.fillStyle = skinColor;
        ctx.fillRect(0, 24, 64, 40);
        ctx.fillStyle = hairColor;
        ctx.fillRect(0, 0, 64, 24);
        ctx.fillStyle = eyeWhite;
        ctx.fillRect(8, 32, 16, 8);
        ctx.fillRect(40, 32, 16, 8);
        ctx.fillStyle = eyeBlue;
        ctx.fillRect(16, 32, 8, 8);
        ctx.fillRect(40, 32, 8, 8);
        ctx.fillStyle = mouthColor;
        ctx.fillRect(24, 44, 16, 12);
        ctx.fillStyle = skinDarkColor;
        ctx.fillRect(24, 40, 16, 4);
    });

    const matBack = makeFaceCanvas((ctx) => {
        ctx.fillStyle = hairColor;
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = skinColor;
        ctx.fillRect(16, 48, 32, 16);
    });

    return [matRight, matLeft, matTop, matBottom, matFront, matBack];
}

function createMap() {
    const arenaSize = 500;
    const floorGeo = new THREE.PlaneGeometry(arenaSize, arenaSize);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x559933 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const wallHeight = 10;
    const wallThickness = 2;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });

    const wallN = new THREE.Mesh(new THREE.BoxGeometry(arenaSize, wallHeight, wallThickness), wallMat);
    wallN.position.set(0, wallHeight / 2, -arenaSize / 2);
    scene.add(wallN);

    const wallS = new THREE.Mesh(new THREE.BoxGeometry(arenaSize, wallHeight, wallThickness), wallMat);
    wallS.position.set(0, wallHeight / 2, arenaSize / 2);
    scene.add(wallS);

    const wallE = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, arenaSize), wallMat);
    wallE.position.set(arenaSize / 2, wallHeight / 2, 0);
    scene.add(wallE);

    const wallW = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, wallHeight, arenaSize), wallMat);
    wallW.position.set(-arenaSize / 2, wallHeight / 2, 0);
    scene.add(wallW);

    const boxGeo = new THREE.BoxGeometry(2, 2, 2);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });

    for (let i = 0; i < 40; i++) {
        const crate = new THREE.Mesh(boxGeo, boxMat);
        const rx = (Math.random() - 0.5) * (arenaSize - 40);
        const rz = (Math.random() - 0.5) * (arenaSize - 40);
        crate.position.set(rx, 1, rz);
        scene.add(crate);
    }
}

function createGun() {
    const gunGroup = new THREE.Group();
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xc68642, transparent: true });

    const armGeo = new THREE.BoxGeometry(0.16, 0.16, 0.6);
    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(-0.15, -0.32, -0.5);
    leftArmGroup.rotation.x = -0.2;
    leftArmGroup.rotation.y = 0.2;
    const leftArm = new THREE.Mesh(armGeo, skinMat);
    leftArm.position.set(0, 0, 0);
    leftArmGroup.add(leftArm);
    gunGroup.add(leftArmGroup);

    const bodyGeo = new THREE.BoxGeometry(0.12, 0.18, 0.7);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x222222, transparent: true });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0.2, -0.25, -0.5);
    gunGroup.add(body);

    const barrelGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.4);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.2, -0.22, -0.9);
    gunGroup.add(barrel);

    const flashGeo = new THREE.SphereGeometry(0.06);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
    muzzleFlash.position.set(0.2, -0.22, -1.1);
    muzzleFlash.visible = false;
    gunGroup.add(muzzleFlash);

    gun = gunGroup;
    camera.add(gun);
    scene.add(camera);

    localPlayerParts = { leftArmGroup };
}

function createSteveCharacter(playerId) {
    const steveGroup = new THREE.Group();

    const shirtMat = new THREE.MeshStandardMaterial({ color: 0x00a8b5, transparent: true });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x3b449b, transparent: true });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xc68642, transparent: true });

    const legGeo = new THREE.BoxGeometry(0.28, 0.75, 0.3);
    
    const leftLeg = new THREE.Mesh(legGeo, pantsMat);
    leftLeg.position.set(-0.15, 0.375, 0);
    leftLeg.userData = { id: playerId, bodyPart: 'leg' };
    steveGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, pantsMat);
    rightLeg.position.set(0.15, 0.375, 0);
    rightLeg.userData = { id: playerId, bodyPart: 'leg' };
    steveGroup.add(rightLeg);

    const bodyGeo = new THREE.BoxGeometry(0.6, 0.75, 0.3);
    const body = new THREE.Mesh(bodyGeo, shirtMat);
    body.position.y = 1.125;
    body.userData = { id: playerId, bodyPart: 'body' };
    steveGroup.add(body);

    const armGeo = new THREE.BoxGeometry(0.28, 0.75, 0.28);
    
    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(-0.44, 1.4, 0); 
    const leftArm = new THREE.Mesh(armGeo, skinMat);
    leftArm.position.set(0, -0.275, 0);
    leftArm.userData = { id: playerId, bodyPart: 'hand' };
    leftArmGroup.add(leftArm);
    steveGroup.add(leftArmGroup);

    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(0.44, 1.4, 0);
    const rightArm = new THREE.Mesh(armGeo, skinMat);
    rightArm.position.set(0, -0.275, 0);
    rightArm.userData = { id: playerId, bodyPart: 'hand' };
    rightArmGroup.add(rightArm);
    steveGroup.add(rightArmGroup);

    const headMaterials = createSteveHeadMaterials();
    const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const head = new THREE.Mesh(headGeo, headMaterials);
    head.position.y = 1.75;
    head.rotation.y = Math.PI;
    head.userData = { id: playerId, bodyPart: 'head' };
    steveGroup.add(head);

    return {
        group: steveGroup,
        leftLeg,
        rightLeg,
        leftArmGroup,
        rightArmGroup,
        body,
        head
    };
}

function createOtherPlayerMesh(id, playerData) {
    if (otherPlayers[id]) return;

    const steveChar = createSteveCharacter(id);
    const playerMesh = steveChar.group;

    const playerGunGroup = new THREE.Group();
    const gunBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.15, 0.6),
        new THREE.MeshStandardMaterial({ color: 0x222222, transparent: true })
    );
    gunBody.position.set(0, -0.3, -0.3);
    playerGunGroup.add(gunBody);

    const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.3),
        new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true })
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, -0.3, -0.6);
    playerGunGroup.add(barrel);

    steveChar.rightArmGroup.add(playerGunGroup);
    steveChar.rightArmGroup.rotation.x = -0.5;

    playerMesh.position.set(playerData.x, playerData.y - 1.62, playerData.z);
    scene.add(playerMesh);

    const nameTag = createNameTag(playerData.name || "Player");
    nameTag.position.set(playerData.x, playerData.y + 0.8, playerData.z);
    scene.add(nameTag);

    playerMesh.traverse((child) => {
        if (child.isMesh && child.userData && child.userData.bodyPart) {
            targets.push(child);
        }
    });

    otherPlayers[id] = {
        mesh: playerMesh,
        nameTag: nameTag,
        leftLeg: steveChar.leftLeg,
        rightLeg: steveChar.rightLeg,
        leftArm: steveChar.leftArmGroup,
        rightArm: steveChar.rightArmGroup,
        body: steveChar.body,
        head: steveChar.head,
        walkTimer: 0,
        isDead: false
    };
}

function setupPointerLock() {
    const blocker = document.getElementById('blocker');

    renderer.domElement.addEventListener('click', () => {
        if (gameStarted && !isLocked && !isDeadLocal) {
            document.body.requestPointerLock();
        }
    });

    if (blocker) {
        blocker.addEventListener('click', () => {
            document.body.requestPointerLock();
        });
    }

    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === document.body) {
            isLocked = true;
            if (blocker) blocker.style.display = 'none';
        } else {
            isLocked = false;
            if (gameStarted && !isDeadLocal && blocker) blocker.style.display = 'flex';
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isLocked || !gameStarted) return;

        const mouseSensitivity = 0.002;
        yaw -= e.movementX * mouseSensitivity;
        pitch -= e.movementY * mouseSensitivity;

        pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch));

        camera.rotation.order = 'YXZ';
        camera.rotation.y = yaw;
        camera.rotation.x = pitch;
    });
}

function setupMobileControls() {
    const style = document.createElement('style');
    style.innerHTML = `
        .mob-btn {
            position: absolute;
            background: rgba(255, 255, 255, 0.25);
            border: 2px solid white;
            color: white;
            font-weight: bold;
            font-size: 16px;
            border-radius: 50%;
            width: 70px;
            height: 70px;
            display: flex;
            align-items: center;
            justify-content: center;
            user-select: none;
            z-index: 100;
            touch-action: none;
        }
        #btn-shoot { right: 30px; bottom: 40px; background: rgba(255, 68, 0, 0.5); width: 80px; height: 80px; }
        #btn-jump { right: 125px; bottom: 30px; }
        #btn-crouch { right: 125px; bottom: 115px; }
    `;
    document.head.appendChild(style);

    const shootBtn = document.createElement('div');
    shootBtn.id = 'btn-shoot';
    shootBtn.className = 'mob-btn';
    shootBtn.innerText = 'FIRE';
    document.body.appendChild(shootBtn);
    shootBtn.addEventListener('touchstart', (e) => { e.preventDefault(); shootMobile(); });

    const jumpBtn = document.createElement('div');
    jumpBtn.id = 'btn-jump';
    jumpBtn.className = 'mob-btn';
    jumpBtn.innerText = 'JUMP';
    document.body.appendChild(jumpBtn);
    jumpBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (canJump && !isCrouching) {
            velocity.y = 8.5;
            canJump = false;
        }
    });

    const crouchBtn = document.createElement('div');
    crouchBtn.id = 'btn-crouch';
    crouchBtn.className = 'mob-btn';
    crouchBtn.innerText = 'SQUAT';
    document.body.appendChild(crouchBtn);
    crouchBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isCrouching = !isCrouching;
        crouchBtn.style.background = isCrouching ? 'rgba(0, 168, 181, 0.6)' : 'rgba(255, 255, 255, 0.25)';
    });
}

function shootMobile() {
    if (isDeadLocal || !gameStarted) return;

    isShooting = true;
    recoilTimer = 0.08;
    muzzleFlash.visible = true;
    setTimeout(() => { muzzleFlash.visible = false; }, 60);

    scene.updateMatrixWorld(true);

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(targets, true);

    if (intersects.length > 0) {
        const hitMesh = intersects[0].object;
        if (hitMesh.userData && hitMesh.userData.id) {
            const targetId = hitMesh.userData.id;
            const part = hitMesh.userData.bodyPart;

            let damage = 0;
            if (part === 'head') damage = 100;
            else if (part === 'body') damage = 50;
            else if (part === 'leg') damage = 20;
            else if (part === 'hand') damage = 15;

            const hitPoint = intersects[0].point;

            socket.emit('playerHit', { targetId, damage, x: hitPoint.x, y: hitPoint.y, z: hitPoint.z });
        }
    }
}

function onKeyDown(e) {
    if (!gameStarted) return;
    switch (e.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyA': moveLeft = true; break;
        case 'KeyD': moveRight = true; break;
        case 'ShiftLeft':
        case 'ShiftRight':
            isCrouching = true;
            break;
        case 'Space': 
            if (canJump && !isCrouching && !isDeadLocal) velocity.y = 8.5; 
            canJump = false;
            break;
    }
}

function onKeyUp(e) {
    if (!gameStarted) return;
    switch (e.code) {
        case 'KeyW': moveForward = false; break;
        case 'KeyS': moveBackward = false; break;
        case 'KeyA': moveLeft = false; break;
        case 'KeyD': moveRight = false; break;
        case 'ShiftLeft':
        case 'ShiftRight':
            isCrouching = false;
            break;
    }
}

function shoot(e) {
    if (!isLocked || e.button !== 0 || isDeadLocal || !gameStarted) return;
    shootMobile();
}

function animate() {
    requestAnimationFrame(animate);

    if (!gameStarted) return;

    const delta = clock.getDelta();

    Object.keys(otherPlayers).forEach(id => {
        const p = otherPlayers[id];
        if (p.isDead) {
            p.mesh.traverse(child => {
                if (child.isMesh && child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => {
                            m.opacity = Math.max(0, m.opacity - delta * 0.35);
                        });
                    } else {
                        child.material.opacity = Math.max(0, child.material.opacity - delta * 0.35);
                    }
                }
            });
            if (p.nameTag && p.nameTag.material) {
                p.nameTag.material.opacity = Math.max(0, p.nameTag.material.opacity - delta * 0.35);
            }
        }
    });

    for (let i = bloodParticles.length - 1; i >= 0; i--) {
        const part = bloodParticles[i];
        part.mesh.position.addScaledVector(part.velocity, delta);
        part.velocity.y -= 9.8 * delta;
        part.life -= delta;
        if (part.life <= 0) {
            scene.remove(part.mesh);
            bloodParticles.splice(i, 1);
        }
    }

    if (isLocked && !isDeadLocal) {
        targetPlayerHeight = isCrouching ? 1.0 : 1.62;
        playerHeight += (targetPlayerHeight - playerHeight) * 15.0 * delta;

        const speed = isCrouching ? 6.0 : 12.0;
        let moveX = 0;
        let moveZ = 0;

        if (moveForward) moveZ += 1;
        if (moveBackward) moveZ -= 1;
        if (moveLeft) moveX -= 1;
        if (moveRight) moveX += 1;

        const isMoving = (moveX !== 0 || moveZ !== 0);

        const moveVector = new THREE.Vector3();
        if (isMoving) {
            const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
            const side = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

            moveVector.addScaledVector(forward, moveZ);
            moveVector.addScaledVector(side, moveX);
            moveVector.normalize();

            playerWalkTimer += delta * 12;
            if (localPlayerParts) {
                const armSwing = Math.sin(playerWalkTimer) * 0.2;
                localPlayerParts.leftArmGroup.rotation.x = -0.2 + armSwing;
            }
        } else {
            playerWalkTimer = 0;
            if (localPlayerParts) {
                localPlayerParts.leftArmGroup.rotation.x += (-0.2 - localPlayerParts.leftArmGroup.rotation.x) * 0.1;
            }
        }

        camera.position.addScaledVector(moveVector, speed * delta);
        camera.position.x = Math.max(-248, Math.min(248, camera.position.x));
        camera.position.z = Math.max(-248, Math.min(248, camera.position.z));

        velocity.y -= 32.0 * delta; 
        camera.position.y += velocity.y * delta;

        if (camera.position.y <= playerHeight) {
            velocity.y = 0;
            canJump = true;

            if (isMoving && !isCrouching) {
                headBobTimer += delta * bobFrequency;
                const bobOffset = Math.sin(headBobTimer) * bobAmplitude;
                camera.position.y = playerHeight + bobOffset;
                
                gun.position.y = Math.sin(headBobTimer * 2) * 0.015;
                gun.position.x = Math.cos(headBobTimer) * 0.015;
            } else {
                headBobTimer = 0;
                camera.position.y = playerHeight;
                gun.position.y = 0;
                gun.position.x = 0;
            }
        }

        socket.emit('playerMovement', {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
            yaw: yaw,
            pitch: pitch,
            isMoving: isMoving,
            isCrouching: isCrouching
        });

        if (isShooting) {
            recoilTimer -= delta;
            gun.position.z += 0.05;
            if (recoilTimer <= 0) {
                isShooting = false;
            }
        } else {
            gun.position.z += (0 - gun.position.z) * 0.1;
        }
    }

    renderer.render(scene, camera);
}

function onWindowResize() {
    if (!gameStarted) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}