// Visual terrain: a displaced, vertex-coloured plane following the shared
// heightfield, plus a float height texture the grass shader samples so blades
// sit exactly on the ground.

import * as THREE from "three";
import { terrainHeight, terrainSlope, fbm } from "../../../shared/terrain";
import { SHADE_EXTENT } from "./Shade";

export const TERRAIN_EXTENT = 144; // rendered ground reaches past the playable rim into the fog
const SEGMENTS = 192;
const HEIGHT_TEX_SIZE = 512;

export interface TerrainBuild {
  mesh: THREE.Mesh;
  heightTex: THREE.DataTexture;
}

export function buildTerrain(sunVisTex: THREE.DataTexture): TerrainBuild {
  const size = TERRAIN_EXTENT * 2;
  const geo = new THREE.PlaneGeometry(size, size, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2); // plane verts now in XZ, +Y up

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const dirtMask = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);

    // vertex colour is a brightness tint over the photo textures (large-scale
    // light/dark mottling); the dirt mask blends the dirt texture in on noise
    // patches (trails) and steeper ground
    const tone = fbm(x * 0.05, z * 0.05, 4242, 3);
    const tint = 0.4 + tone * 0.5;
    colors[i * 3] = tint;
    colors[i * 3 + 1] = tint;
    colors[i * 3 + 2] = tint * 0.94;

    dirtMask[i] = dirtAmountAt(x, z);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aDirt", new THREE.BufferAttribute(dirtMask, 1));
  geo.computeVertexNormals();

  // tiled photo textures (from the EZ-Tree demo assets, MIT) splat-blended by
  // the per-vertex dirt mask
  const loader = new THREE.TextureLoader();
  const tile = (t: THREE.Texture, srgb: boolean) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(TEX_REPEAT, TEX_REPEAT);
    t.anisotropy = 4; // grazing-angle sharpness; 4 taps is the sweet spot
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const grassTex = tile(loader.load("/textures/grass.jpg"), true);
  const dirtTex = tile(loader.load("/textures/dirt_color.jpg"), true);
  const dirtNormal = tile(loader.load("/textures/dirt_normal.jpg"), false);

  const mat = new THREE.MeshStandardMaterial({
    map: grassTex,
    normalMap: dirtNormal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    vertexColors: true,
    roughness: 1.0,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDirt = { value: dirtTex };
    shader.uniforms.uSunVis = { value: sunVisTex };
    shader.uniforms.uShadeExtent = { value: SHADE_EXTENT };
    shader.vertexShader =
      "attribute float aDirt;\nvarying float vDirt;\nvarying vec2 vWorldXZ;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n  vDirt = aDirt;\n  vWorldXZ = position.xz;"
      );
    shader.fragmentShader =
      "uniform sampler2D uDirt;\nuniform sampler2D uSunVis;\nuniform float uShadeExtent;\nvarying float vDirt;\nvarying vec2 vWorldXZ;\n" +
      shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
          vec4 groundColor = mix(texture2D(map, vMapUv), texture2D(uDirt, vMapUv), vDirt);
          // baked canopy/trunk shade (gentler here — the real shadow map also applies)
          float sunVis = texture2D(uSunVis, (vWorldXZ + uShadeExtent) / (2.0 * uShadeExtent)).r;
          groundColor.rgb *= mix(0.62, 1.06, sunVis);
          diffuseColor *= groundColor;
        #endif`
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;

  return { mesh, heightTex: buildHeightTexture() };
}

const TEX_REPEAT = 64; // ~4.5 m per tile across the 288 m ground plane

// How much bare dirt shows at a spot (0 = lush grass, 1 = bare soil). The
// SAME function drives the ground texture blend and grass clump placement, so
// clumps grow exactly where the ground looks grassy — like the reference.
export function dirtAmountAt(x: number, z: number): number {
  const patch = fbm(x * 0.085, z * 0.085, 5151, 3);
  const slope = terrainSlope(x, z);
  // grass dominates; dirt is the exception (patches + steep ground)
  return Math.max(
    THREE.MathUtils.smoothstep(patch, 0.64, 0.8),
    THREE.MathUtils.smoothstep(slope, 0.5, 0.95) * 0.85
  );
}

// R32F texture of terrain height over [-TERRAIN_EXTENT, TERRAIN_EXTENT]^2.
// Office Macs support float-linear filtering, which keeps grass smooth.
function buildHeightTexture(): THREE.DataTexture {
  const n = HEIGHT_TEX_SIZE;
  const data = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = (ix / (n - 1)) * 2 * TERRAIN_EXTENT - TERRAIN_EXTENT;
      const z = (iz / (n - 1)) * 2 * TERRAIN_EXTENT - TERRAIN_EXTENT;
      data[iz * n + ix] = terrainHeight(x, z);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
