import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x202025)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100)
camera.position.set(0.5, 1.0, 1.8)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)


// disable zoom
// renderer.domElement.addEventListener('wheel', (e) => {
//   e.preventDefault()
//   // move forward/back along whichever way camera is facing
//   const direction = new THREE.Vector3()
//   camera.getWorldDirection(direction)
//   camera.position.addScaledVector(direction, -e.deltaY * 0.005)
//   // clamp so you can't go too close or too far
//   camera.position.clampLength(0, 10)
// }, { passive: false })

const dirLight = new THREE.DirectionalLight(0xffffff, 2)
dirLight.position.set(5, 10, 5)
scene.add(dirLight)
scene.add(new THREE.AmbientLight(0xffffff, 0.5))

// Head rotation — camera rotates in place
let yaw = 0
let pitch = 0
const YAW_LIMIT = Math.PI / 3    // ±60° left/right
const PITCH_LIMIT = 0.05         // nearly locked vertical

let isDown = false
let lastX = 0, lastY = 0

window.addEventListener('pointerdown', (e) => {
  isDown = true
  lastX = e.clientX
  lastY = e.clientY
})
window.addEventListener('pointerup', () => { isDown = false })
window.addEventListener('pointermove', (e) => {
  if (!isDown) return
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY

  yaw -= dx * 0.003
  yaw = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, yaw))

  pitch -= dy * 0.003
  pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch))
})

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10),
  new THREE.MeshStandardMaterial({ color: 0x444444 })
)
floor.rotation.x = -Math.PI / 2
scene.add(floor)

let mixer

const loader = new GLTFLoader()
loader.load('/yuki.glb', (gltf) => {
  const model = gltf.scene
  scene.add(model)

  model.position.set(-1.0, 0.0, 1.8)
  model.rotation.y = Math.PI

  mixer = new THREE.AnimationMixer(model)
  if (gltf.animations.length > 0) {
    mixer.clipAction(gltf.animations[0]).play()
  }
})

const clock = new THREE.Clock()

function animate() {
  requestAnimationFrame(animate)

  const delta = clock.getDelta()
  if (mixer) mixer.update(delta)

  camera.rotation.order = 'YXZ'
  camera.rotation.y = yaw
  camera.rotation.x = pitch

  renderer.render(scene, camera)
}

animate()