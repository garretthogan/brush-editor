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

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(viewport.clientWidth, viewport.clientHeight)
  renderer.shadowMap.enabled = false
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.5
  viewport.appendChild(renderer.domElement)
  pickRectElement = renderer.domElement
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()

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
