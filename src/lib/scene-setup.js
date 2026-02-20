import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { Sky } from 'three/addons/objects/Sky.js'

export function initScene({ gridColor }) {
  const viewport = document.getElementById('viewport')
  let pickRectElement = viewport
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)

  const sky = new Sky()
  sky.scale.setScalar(450000)
  scene.add(sky)
  const sun = new THREE.Vector3()
  sky.visible = false

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000)
  camera.position.set(8, 8, 8)

  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true })
  } catch (err) {
    // Headless or restricted GPU (e.g. CI) may not support WebGL; keep UI functional
    const canvas = document.createElement('canvas')
    viewport.appendChild(canvas)
    pickRectElement = canvas
    renderer = {
      domElement: canvas,
      setPixelRatio: () => {},
      setSize: () => {},
      shadowMap: { enabled: false },
      outputColorSpace: '',
      toneMapping: 0,
      toneMappingExposure: 0.5,
      render: () => {},
      capabilities: { getMaxAnisotropy: () => 1 },
    }
  }
  const maxAnisotropy =
    renderer.capabilities?.getMaxAnisotropy?.() ?? 1
  if (renderer.setPixelRatio) renderer.setPixelRatio(window.devicePixelRatio)
  if (renderer.setSize) renderer.setSize(viewport.clientWidth, viewport.clientHeight)
  if (renderer.shadowMap) renderer.shadowMap.enabled = false
  if (renderer.outputColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace
  if (renderer.toneMapping !== undefined) renderer.toneMapping = THREE.ACESFilmicToneMapping
  if (renderer.toneMappingExposure !== undefined) renderer.toneMappingExposure = 0.5
  if (!viewport.contains(renderer.domElement)) {
    viewport.appendChild(renderer.domElement)
  }
  pickRectElement = renderer.domElement

  const grid = new THREE.GridHelper(20, 20, gridColor, gridColor)
  grid.position.y = -0.01
  grid.renderOrder = -1
  grid.material.depthWrite = false
  scene.add(grid)

  const orbitControls = new OrbitControls(camera, renderer.domElement)
  orbitControls.enableDamping = true
  orbitControls.dampingFactor = 0.05
  orbitControls.autoRotate = false
  orbitControls.autoRotateSpeed = 0
  orbitControls.enableZoom = false
  orbitControls.enableRotate = false
  orbitControls.enablePan = false

  const transformControls = new TransformControls(camera, renderer.domElement)
  transformControls.setSize(0.4)
  transformControls.enabled = false
  const transformControlsHelper = transformControls.getHelper()
  transformControlsHelper.visible = false
  transformControlsHelper.traverse((child) => {
    child.frustumCulled = false
    if (child.material) {
      child.material.depthTest = false
    }
    child.renderOrder = 1000
  })
  scene.add(transformControlsHelper)

  return {
    viewport,
    pickRectElement,
    scene,
    sky,
    sun,
    camera,
    renderer,
    maxAnisotropy,
    grid,
    orbitControls,
    transformControls,
    transformControlsHelper,
  }
}
