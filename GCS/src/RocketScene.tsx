import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type SceneStatus = "preparing" | "ready" | "error";

export type Attitude = {
  roll: number;
  pitch: number;
  yaw: number;
};

type RocketSceneProps = {
  deployed: boolean;
  altitude: number;
  attitude?: Attitude | null;
};

const YAW_LIMIT = 0.9;
const DEG_TO_RAD = Math.PI / 180;

// Mount frame (X right, Y forward, Z up along the rocket) to three.js (X right, Y up, Z toward camera).
// Yaw about mount Z = three Y, pitch about mount Y = three -Z, roll about mount X = three X.
function attitudeQuaternion(attitude: Attitude | null | undefined, out: THREE.Quaternion) {
  if (
    !attitude ||
    !Number.isFinite(attitude.roll) ||
    !Number.isFinite(attitude.pitch) ||
    !Number.isFinite(attitude.yaw)
  ) {
    return out.identity();
  }
  const euler = new THREE.Euler(
    attitude.roll * DEG_TO_RAD,
    attitude.yaw * DEG_TO_RAD,
    -attitude.pitch * DEG_TO_RAD,
    "YZX",
  );
  return out.setFromEuler(euler);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readToken(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function tokenColor(name: string, fallback: string): THREE.Color {
  return new THREE.Color(readToken(name, fallback));
}

export function RocketScene({ deployed, altitude, attitude }: RocketSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef({ deployed, altitude, attitude });
  const yawRef = useRef(0);
  const dragRef = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    startYaw: 0,
  });
  const [status, setStatus] = useState<SceneStatus>("preparing");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    targetRef.current = { deployed, altitude, attitude };
  }, [deployed, altitude, attitude]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      setStatus("error");
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);

    const sceneBg = tokenColor("--scene-bg", "#16181c");
    const sceneBody = tokenColor("--scene-body", "#d8dade");
    const sceneGraphite = tokenColor("--scene-graphite", "#2c3036");
    const sceneMetal = tokenColor("--scene-metal", "#1c1f23");
    const sceneFloor = tokenColor("--scene-floor", "#1b1e23");
    const sceneRule = tokenColor("--scene-rule", "#3b4048");
    const sceneAmber = tokenColor("--scene-amber", "#e4b05a");
    const sceneCool = tokenColor("--scene-cool", "#93b8ea");
    const sceneKey = tokenColor("--scene-key", "#fff2dc");
    const sceneSky = tokenColor("--scene-sky", "#c9d6e6");

    const scene = new THREE.Scene();
    scene.background = sceneBg;
    scene.fog = new THREE.Fog(sceneBg, 15, 34);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: sceneBody,
      roughness: 0.42,
      metalness: 0.28,
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: sceneAmber,
      roughness: 0.36,
      metalness: 0.32,
    });
    const finMaterial = new THREE.MeshStandardMaterial({
      color: sceneGraphite,
      roughness: 0.5,
      metalness: 0.52,
    });
    const metalMaterial = new THREE.MeshStandardMaterial({
      color: sceneMetal,
      roughness: 0.3,
      metalness: 0.82,
    });
    const canopyMaterial = new THREE.MeshStandardMaterial({
      color: sceneBody,
      roughness: 0.92,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const coolMaterial = new THREE.MeshStandardMaterial({
      color: sceneCool,
      roughness: 0.45,
      metalness: 0.3,
    });
    const lineMaterial = new THREE.LineBasicMaterial({
      color: sceneRule,
      transparent: true,
      opacity: 0.9,
    });

    const world = new THREE.Group();
    scene.add(world);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 70),
      new THREE.MeshStandardMaterial({
        color: sceneFloor,
        roughness: 0.98,
        metalness: 0,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    world.add(floor);

    const grid = new THREE.GridHelper(70, 35, sceneRule, sceneRule);
    grid.position.y = 0.015;
    const gridMaterial = grid.material as THREE.LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.3;
    world.add(grid);

    const padMaterial = new THREE.MeshStandardMaterial({
      color: sceneGraphite,
      roughness: 0.72,
      metalness: 0.25,
    });
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.45, 0.3, 64),
      padMaterial,
    );
    pad.position.y = 0.15;
    pad.castShadow = true;
    pad.receiveShadow = true;
    world.add(pad);

    const padRingPoints = (radius: number, y: number) =>
      Array.from({ length: 72 }, (_, index) => {
        const angle = (index / 72) * Math.PI * 2;
        return new THREE.Vector3(
          Math.cos(angle) * radius,
          y,
          Math.sin(angle) * radius,
        );
      });
    const padRing = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(padRingPoints(1.78, 0.305)),
      lineMaterial,
    );
    world.add(padRing);
    const padRingInner = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(padRingPoints(0.92, 0.305)),
      lineMaterial,
    );
    world.add(padRingInner);

    const railHeight = 40;
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, railHeight, 0.1),
      metalMaterial,
    );
    rail.position.set(-1.15, railHeight / 2, 0);
    rail.castShadow = true;
    world.add(rail);

    const rungGeometry = new THREE.BoxGeometry(0.34, 0.04, 0.06);
    for (let index = 0; index < 24; index += 1) {
      const rung = new THREE.Mesh(rungGeometry, finMaterial);
      rung.position.set(-1.15, 0.6 + index * 0.9, 0);
      world.add(rung);
    }

    const rocket = new THREE.Group();
    scene.add(rocket);

    const nozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.3, 0.36, 32, 1, true),
      metalMaterial,
    );
    nozzle.position.y = 0.52;
    nozzle.castShadow = true;
    rocket.add(nozzle);

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.46, 3.1, 64),
      bodyMaterial,
    );
    body.position.y = 2.25;
    body.castShadow = true;
    body.receiveShadow = true;
    rocket.add(body);

    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 1.15, 64),
      bodyMaterial,
    );
    nose.position.y = 4.375;
    nose.castShadow = true;
    rocket.add(nose);

    const accentBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.43, 0.442, 0.16, 64, 1, true),
      accentMaterial,
    );
    accentBand.position.y = 3.48;
    accentBand.castShadow = true;
    rocket.add(accentBand);

    const baseBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.456, 0.464, 0.06, 64, 1, true),
      coolMaterial,
    );
    baseBand.position.y = 0.92;
    rocket.add(baseBand);

    const accessPanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.66, 0.02),
      finMaterial,
    );
    accessPanel.position.set(0, 2.5, 0.437);
    rocket.add(accessPanel);

    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0.52, 0);
    finShape.lineTo(0.52, 0.46);
    finShape.lineTo(0.02, 1.02);
    finShape.closePath();
    const finGeometry = new THREE.ExtrudeGeometry(finShape, {
      depth: 0.05,
      bevelEnabled: false,
    });

    for (let index = 0; index < 4; index += 1) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (index / 4) * Math.PI * 2;
      const fin = new THREE.Mesh(finGeometry, finMaterial);
      fin.position.set(0.42, 0.74, -0.025);
      fin.castShadow = true;
      pivot.add(fin);
      if (index === 0) {
        const finMark = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.26, 0.075),
          accentMaterial,
        );
        finMark.position.set(0.95, 0.94, 0);
        pivot.add(finMark);
      }
      rocket.add(pivot);
    }

    const chute = new THREE.Group();
    chute.visible = false;
    rocket.add(chute);

    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(1.12, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      canopyMaterial,
    );
    canopy.position.y = 6.34;
    canopy.castShadow = true;
    chute.add(canopy);

    const canopyRim = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.012, 8, 72),
      coolMaterial,
    );
    canopyRim.rotation.x = Math.PI / 2;
    canopyRim.position.y = 6.34;
    chute.add(canopyRim);

    const linePoints: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      linePoints.push(
        Math.cos(angle) * 1.1,
        6.34,
        Math.sin(angle) * 1.1,
        0,
        4.96,
        0,
      );
    }
    const shroudLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(linePoints, 3),
      ),
      lineMaterial,
    );
    chute.add(shroudLines);

    const hemisphere = new THREE.HemisphereLight(sceneSky, sceneFloor, 1.15);
    scene.add(hemisphere);

    const keyLight = new THREE.DirectionalLight(sceneKey, 2.05);
    keyLight.position.set(5, 9, 7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 32;
    keyLight.shadow.camera.left = -6;
    keyLight.shadow.camera.right = 6;
    keyLight.shadow.camera.top = 12;
    keyLight.shadow.camera.bottom = -5;
    keyLight.shadow.bias = -0.0006;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(sceneCool, 0.7);
    fillLight.position.set(-6, 4, -4);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(sceneCool, 0.45);
    rimLight.position.set(0, 5, -8);
    scene.add(rimLight);

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = motionQuery.matches;
    const onMotionChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
    };
    motionQuery.addEventListener("change", onMotionChange);

    let currentYaw = 0;
    let currentDistance = 9.6;
    let currentCameraY = 3.2;
    let currentLookY = 2.7;
    let chuteScale = 0.001;
    let frame = 0;
    const targetAttitude = new THREE.Quaternion();

    const clock = new THREE.Timer();
    clock.connect(document);

    const render = () => {
      clock.update();
      const delta = Math.min(clock.getDelta(), 0.05);
      const smoothing = (rate: number) =>
        reduceMotion ? 1 : Math.min(1, delta * rate);

      currentYaw +=
        (yawRef.current - currentYaw) * smoothing(10);

      const targetDistance = targetRef.current.deployed ? 13.2 : 9.6;
      const targetCameraY = targetRef.current.deployed ? 3.9 : 3.2;
      const targetLookY = targetRef.current.deployed ? 3.2 : 2.7;

      currentDistance +=
        (targetDistance - currentDistance) * smoothing(4);
      currentCameraY +=
        (targetCameraY - currentCameraY) * smoothing(4);
      currentLookY += (targetLookY - currentLookY) * smoothing(4);

      const targetWorldY =
        -Math.min(targetRef.current.altitude, 950) * 0.0035;
      world.position.y +=
        (targetWorldY - world.position.y) * smoothing(6);

      attitudeQuaternion(targetRef.current.attitude, targetAttitude);
      rocket.quaternion.slerp(targetAttitude, smoothing(5));

      const targetChute = targetRef.current.deployed ? 1 : 0.001;
      chuteScale += (targetChute - chuteScale) * smoothing(6);
      chute.scale.setScalar(chuteScale);
      if (targetRef.current.deployed) {
        chute.visible = true;
      } else if (chuteScale < 0.02) {
        chute.visible = false;
      }

      camera.position.set(
        Math.sin(currentYaw) * currentDistance,
        currentCameraY,
        Math.cos(currentYaw) * currentDistance,
      );
      camera.lookAt(0, currentLookY, 0);

      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };

    setStatus("ready");
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      clock.disconnect();
      motionQuery.removeEventListener("change", onMotionChange);
      if (renderer.domElement.parentElement === host) {
        host.removeChild(renderer.domElement);
      }
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = (mesh as THREE.Mesh).material;
        if (Array.isArray(material)) {
          material.forEach((entry) => entry.dispose());
        } else if (material) {
          material.dispose();
        }
      });
      renderer.dispose();
    };
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startYaw: yawRef.current,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const offset = (event.clientX - drag.startX) * 0.006;
    yawRef.current = clamp(drag.startYaw + offset, -YAW_LIMIT, YAW_LIMIT);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current.active = false;
    setDragging(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -0.12 : 0.12;
      yawRef.current = clamp(yawRef.current + step, -YAW_LIMIT, YAW_LIMIT);
    }
    if (event.key === "Home") {
      event.preventDefault();
      yawRef.current = 0;
    }
  };

  return (
    <div
      ref={hostRef}
      className={`scene-canvas${dragging ? " is-dragging" : ""}`}
      role="group"
      tabIndex={0}
      aria-label="Rocket view. Drag sideways or use the left and right arrow keys to rotate. The view is locked to the front arc."
      aria-keyshortcuts="ArrowLeft ArrowRight Home"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      {status !== "ready" ? (
        <div className="scene-message" role="status">
          {status === "preparing"
            ? "Preparing the vehicle view."
            : "The 3D view could not start because WebGL is unavailable in this window."}
        </div>
      ) : null}
    </div>
  );
}
