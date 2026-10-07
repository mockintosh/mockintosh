import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Loads the Macintosh Plus GLB model and replaces the "screen" mesh's
 * material with our CRT shader so the OS raster renders onto it.
 *
 * The "screen_glass" mesh sits in front of the screen as a transparent
 * glass overlay providing clearcoat reflections. This mirrors the real
 * hardware: the phosphor is on the flat inner surface and the curved
 * glass sits in front.
 *
 * The GLB is expected to contain a mesh named "screen" with UVs that
 * span [0,1] over the screen surface. The OS raster occupies a
 * sub-rectangle of that UV space defined by the RASTER_UV_* constants.
 */

const TEXTURED_MODEL_PATH = "/mockintosh-simple.glb";
const TEXTURED_MODEL_SCALE = 1;

/** Real-world Mac Plus height (mm), for inferring model units from bounding box. */
const MAC_PLUS_HEIGHT_MM = 354;

/**
 * UV-space bounds of the OS raster within the screen mesh.
 *
 * The screen mesh is ~193mm wide x ~152mm tall (real-world Mac Plus dimensions).
 * The OS raster is 512x342 pixels.
 *
 * We define a horizontal inset and derive the vertical inset
 * to preserve the OS aspect ratio on the physical screen surface.
 *
 * These mm values are used only to form the screen's aspect ratio (width/height).
 * They do not depend on the GLB's unit scale or TEXTURED_MODEL_SCALE—UVs are
 * normalized on the mesh regardless of world-space size.
 */
const SCREEN_WIDTH_MM = 193;
const SCREEN_HEIGHT_MM = 152;
const RASTER_ASPECT = 512 / 342;
const SCREEN_ASPECT = SCREEN_WIDTH_MM / SCREEN_HEIGHT_MM;

const H_INSET = 0.105;
const rasterUWidth = 1.0 - 2 * H_INSET;
const rasterPhysicalW = rasterUWidth * SCREEN_WIDTH_MM;
const rasterPhysicalH = rasterPhysicalW / RASTER_ASPECT;
const rasterVHeight = rasterPhysicalH / SCREEN_HEIGHT_MM;
const V_INSET = (1.0 - rasterVHeight) / 2;

export const RASTER_UV_MIN_X = H_INSET;
export const RASTER_UV_MAX_X = 1.0 - H_INSET;
export const RASTER_UV_MIN_Y = V_INSET;
export const RASTER_UV_MAX_Y = 1.0 - V_INSET;

export interface MacPlusModelResult {
  group: THREE.Group;
  crtMesh: THREE.Mesh;
  /** The brightness adjustment knob on the front-left of the case. */
  brightnessKnob: THREE.Mesh | null;
  /** The original material from the GLB, for use when the screen is off. */
  screenOffMaterial: THREE.Material;
}

export async function loadMacPlusModel(
  crtMaterial: THREE.Material
): Promise<MacPlusModelResult> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(TEXTURED_MODEL_PATH);

  const group = gltf.scene;
  logNonUnitScales(group, "GLB (before TEXTURED_MODEL_SCALE)");
  group.scale.setScalar(TEXTURED_MODEL_SCALE);

  let crtMesh: THREE.Mesh | null = null;
  let screenOffMaterial: THREE.Material | null = null;
  let brightnessKnob: THREE.Mesh | null = null;

  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    if (child.name === "screen") {
      console.log("found screen");
      screenOffMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x020203,
        roughness: 0.15,
        metalness: 0.0,
        clearcoat: 0.4,
        clearcoatRoughness: 0.1,
      });
      child.material = crtMaterial;
      crtMesh = child;
    } else if (child.name === "screen_glass") {
      console.log("found screen_glass");
      child.material = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.0,
        metalness: 0.0,
        transmission: 1.0,
        /** Glass thickness in scene units; affects transmission/refraction. Tune to match model scale (e.g. ~3–5 mm real glass → scale-appropriate value). */
        thickness: 0.02, // 2mm thick,
        ior: 1.52,
        /** Lower = sharper reflections at grazing angles (can show opposite side). Higher = softer sheen. */
        clearcoat: 1.0,
        // clearcoatRoughness: 1,
      });
      child.frustumCulled = false;
      child.renderOrder = 1;
    } else if (child.name === "twist") {
      brightnessKnob = child;
    }
  });

  // Uncomment to test refraction without the case (confirms bezel was occluding refracted samples):
  // group.traverse((child) => { if (child.name === "pc_case") child.visible = false; });

  if (!crtMesh) {
    throw new Error(
      'GLB model missing "screen" mesh. Available meshes: ' +
        getMeshNames(group).join(", ")
    );
  }

  logScreenRasterCoverage(crtMesh);
  logModelScale(group);

  return {
    group,
    crtMesh,
    brightnessKnob,
    screenOffMaterial: screenOffMaterial!,
  };
}

const SCALE_EPS = 1e-5;

function isUnitScale(s: THREE.Vector3): boolean {
  return (
    Math.abs(s.x - 1) < SCALE_EPS &&
    Math.abs(s.y - 1) < SCALE_EPS &&
    Math.abs(s.z - 1) < SCALE_EPS
  );
}

/**
 * Logs the screen mesh's UV range and the raster UV bounds so we can see if the
 * CRT content (raster) extends far enough. If the mesh UVs don't span [0,1],
 * or the raster insets are large, the reflective "border" (outside raster) may
 * be visible and reflect the bezel at sharp angles.
 */
function logScreenRasterCoverage(screenMesh: THREE.Mesh): void {
  const geo = screenMesh.geometry;
  const uvAttr = geo.getAttribute("uv") ?? geo.getAttribute("uv2");
  const box = new THREE.Box3().setFromObject(screenMesh);

  const rasterU = (1 - 2 * H_INSET) * 100;
  const rasterV = (1 - 2 * V_INSET) * 100;
  console.log("[MacPlusModel] CRT raster coverage (UV space):", {
    rasterMin: [RASTER_UV_MIN_X, RASTER_UV_MIN_Y],
    rasterMax: [RASTER_UV_MAX_X, RASTER_UV_MAX_Y],
    rasterWidthPercent: rasterU.toFixed(1) + "%",
    rasterHeightPercent: rasterV.toFixed(1) + "%",
    borderH: H_INSET,
    borderV: V_INSET,
  });

  if (uvAttr) {
    const count = uvAttr.count;
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;
    for (let i = 0; i < count; i++) {
      const u = uvAttr.getX(i);
      const v = uvAttr.getY(i);
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    console.log("[MacPlusModel] Screen mesh UV range:", {
      u: [minU, maxU],
      v: [minV, maxV],
      spansZeroOne:
        minU <= 0 && maxU >= 1 && minV <= 0 && maxV >= 1
          ? "yes"
          : "no — raster bounds may not align with visible area",
    });
  } else {
    console.warn("[MacPlusModel] Screen mesh has no uv/uv2 attribute.");
  }

  console.log("[MacPlusModel] Screen mesh world bounds:", {
    min: box.min.toArray(),
    max: box.max.toArray(),
    size: box.getSize(new THREE.Vector3()).toArray(),
  });
}

/**
 * Logs the full model's world-space size and infers scale from known Mac Plus height.
 * Run after group.scale is applied so the box is in final units.
 */
function logModelScale(group: THREE.Group): void {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const heightUnits = size.y;
  const unitsPerMm = heightUnits / MAC_PLUS_HEIGHT_MM;
  console.log("[MacPlusModel] Model bounds (after scale):", {
    size: { x: size.x, y: size.y, z: size.z },
    heightUnits,
    realHeightMm: MAC_PLUS_HEIGHT_MM,
    inferredUnitsPerMm: unitsPerMm,
    note: "If heightUnits ≈ 0.345 then model is in meters; if ≈ 345 then in mm.",
  });
}

/** Logs any object in the hierarchy whose scale is not (1,1,1). */
function logNonUnitScales(root: THREE.Object3D, label: string): void {
  const odd: { name: string; scale: [number, number, number] }[] = [];
  root.traverse((child) => {
    if (!isUnitScale(child.scale)) {
      odd.push({
        name: child.name || "(unnamed)",
        scale: [child.scale.x, child.scale.y, child.scale.z],
      });
    }
  });
  if (odd.length > 0) {
    console.warn(
      `[MacPlusModel] ${label}: non-unit scale on ${odd.length} object(s):`,
      odd
    );
  } else {
    console.log(`[MacPlusModel] ${label}: all scales are (1,1,1).`);
  }
}

function getMeshNames(root: THREE.Object3D): string[] {
  const names: string[] = [];
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      names.push(child.name || "(unnamed)");
    }
  });
  return names;
}
