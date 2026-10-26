import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { SceneModel, TrackItem } from './model'
import { parentOf } from './model'
import { playback } from '@app/playback'
import { useStore } from '@app/store'
import { useL } from '@app/i18n'
import { posAt, rotAt } from '@core/analysis/poses'

const AXIS_COLORS = [0xff5c5c, 0x4cd964, 0x4d8dff]

function textSprite(text: string, color = '#ffffff', size = 64) {
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  ctx.font = `bold ${size}px sans-serif`
  const w = Math.ceil(ctx.measureText(text).width) + 16
  c.width = w
  c.height = size + 16
  ctx.font = `bold ${size}px sans-serif`
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.shadowColor = '#000'
  ctx.shadowBlur = 6
  ctx.fillText(text, 8, c.height / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  s.renderOrder = 10
  s.userData.aspect = w / c.height
  return s
}

/** RGB triad with arrow heads (X red, Y green, Z blue). */
function triad(length: number, opts: { labels?: boolean; opacity?: number; headRatio?: number } = {}) {
  const g = new THREE.Group()
  const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
  dirs.forEach((d, i) => {
    const a = new THREE.ArrowHelper(d, new THREE.Vector3(), length, AXIS_COLORS[i], length * (opts.headRatio ?? 0.25), length * 0.12)
    if (opts.opacity != null) {
      for (const m of [a.line.material, a.cone.material] as THREE.Material[]) {
        m.transparent = true
        m.opacity = opts.opacity
      }
    }
    g.add(a)
    if (opts.labels) {
      const s = textSprite('XYZ'[i], '#' + AXIS_COLORS[i].toString(16).padStart(6, '0'))
      s.position.copy(d.clone().multiplyScalar(length * 1.18))
      s.scale.set(length * 0.22 * s.userData.aspect, length * 0.22, 1)
      g.add(s)
    }
  })
  return g
}

function setPose(obj: THREE.Object3D, p: [number, number, number] | null, R: number[] | null) {
  if (p) obj.position.set(p[0], p[1], p[2])
  if (R) {
    const m = new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1)
    obj.quaternion.setFromRotationMatrix(m)
  }
  obj.visible = Boolean(p || R)
}

export function Scene3D({ model }: { model: SceneModel }) {
  const L = useL()
  const host = useRef<HTMLDivElement>(null)
  const upAxis = useStore((s) => s.settings.upAxis)
  const ghosts = useStore((s) => s.settings.showGhostFrames)
  const horizon = useStore((s) => s.settings.chunkHorizon)
  const updateSettings = useStore((s) => s.updateSettings)
  const defaultFrame = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of model.tracks.filter((t) => t.seg.role !== 'base_pose')) counts.set(parentOf(t.seg), (counts.get(parentOf(t.seg)) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? model.robot?.frame ?? model.frames[0] ?? 'base'
  }, [model])
  const [frame, setFrame] = useState(defaultFrame)
  const [showAction, setShowAction] = useState(false)
  const [showCams, setShowCams] = useState(true)
  const [showTrail, setShowTrail] = useState(true)
  const [menu, setMenu] = useState(false)
  useEffect(() => setFrame(defaultFrame), [defaultFrame])

  const visible = useMemo(() => {
    const inFrame = (t: TrackItem) => parentOf(t.seg) === frame
    // when the same EEF exists as "ee" and "tcp" or in several features, keep them all but they are labelled
    return {
      tracks: model.tracks.filter(inFrame),
      actions: showAction ? model.actionTracks.filter(inFrame) : [],
      cameras: showCams ? model.cameras.filter((c) => parentOf(c.track.segment) === frame) : [],
      skeleton: model.skeleton && (frame === 'world' || model.skeleton.tracks.every((t) => parentOf(t.segment) === frame)) ? model.skeleton : null,
      robot: model.robot && model.robot.frame === frame ? model.robot : null,
    }
  }, [model, frame, showAction, showCams])

  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.005, 100)
    const up = upAxis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
    camera.up.copy(up)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    scene.add(new THREE.AmbientLight(0xffffff, 1))

    // bounding box of everything visible
    const box = new THREE.Box3()
    const addPts = (tr: TrackItem['track']) => {
      if (!tr.pos) return
      const step = Math.max(1, Math.floor(tr.length / 400))
      for (let t = 0; t < tr.length; t += step) {
        const p = posAt(tr, t)
        if (p) box.expandByPoint(new THREE.Vector3(...p))
      }
    }
    visible.tracks.forEach((t) => addPts(t.track))
    visible.cameras.forEach((c) => addPts(c.track))
    visible.skeleton?.tracks.forEach((t) => addPts(t))
    if (visible.robot) {
      const step = Math.max(1, Math.floor(model.length / 20))
      for (let t = 0; t < model.length; t += step) for (const T of visible.robot.fk(t).values()) box.expandByPoint(new THREE.Vector3(T[3], T[7], T[11]))
    }
    box.expandByPoint(new THREE.Vector3(0, 0, 0))
    const size = box.getSize(new THREE.Vector3())
    const extent = Math.max(size.x, size.y, size.z, 0.2)
    const center = box.getCenter(new THREE.Vector3())
    const axisLen = Math.max(0.03, extent * 0.07)

    // reference frame + grid
    const world = triad(axisLen * 2, { labels: true, headRatio: 0.18 })
    scene.add(world)
    const frameLabel = textSprite(frame, '#8b9ab0', 40)
    frameLabel.position.set(-axisLen * 0.4, -axisLen * 0.4, -axisLen * 0.4)
    frameLabel.scale.set(axisLen * 0.5 * frameLabel.userData.aspect, axisLen * 0.5, 1)
    scene.add(frameLabel)
    const gridSize = Math.pow(10, Math.ceil(Math.log10(extent * 2)))
    const grid = new THREE.GridHelper(gridSize, 20, 0x2f3b4d, 0x1d2633)
    if (upAxis === 'z') grid.rotation.x = Math.PI / 2
    scene.add(grid)

    camera.position.copy(center.clone().add(new THREE.Vector3(extent * 1.4, -extent * 1.6, extent * 1.1)))
    if (upAxis === 'y') camera.position.copy(center.clone().add(new THREE.Vector3(extent * 1.4, extent * 1.1, extent * 1.6)))
    controls.target.copy(center)

    type Live = { update: (f: number) => void }
    const live: Live[] = []

    const makeTrack = (it: TrackItem, isAction: boolean) => {
      const tr = it.track
      const color = new THREE.Color(it.color)
      if (tr.pos && showTrail) {
        const pts: number[] = []
        const cols: number[] = []
        for (let t = 0; t < tr.length; t++) {
          const p = posAt(tr, t)
          if (!p) continue
          pts.push(...p)
          const k = 0.25 + 0.75 * (t / Math.max(1, tr.length - 1))
          cols.push(color.r * k, color.g * k, color.b * k)
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
        geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
        const mat = isAction ? new THREE.LineDashedMaterial({ vertexColors: true, dashSize: axisLen * 0.3, gapSize: axisLen * 0.2, transparent: true, opacity: 0.8 }) : new THREE.LineBasicMaterial({ vertexColors: true })
        const line = new THREE.Line(geo, mat)
        if (isAction) line.computeLineDistances()
        scene.add(line)
      }
      // ghost triads along the trajectory
      if (ghosts && tr.rot && tr.pos && !isAction) {
        const n = 14
        const verts: number[] = []
        const cols: number[] = []
        const gl = axisLen * 0.55
        for (let k = 0; k < n; k++) {
          const t = Math.round((k / (n - 1)) * (tr.length - 1))
          const p = posAt(tr, t)
          const R = rotAt(tr, t)
          if (!p || !R) continue
          for (let a = 0; a < 3; a++) {
            verts.push(...p, p[0] + R[a] * gl, p[1] + R[3 + a] * gl, p[2] + R[6 + a] * gl)
            const c = new THREE.Color(AXIS_COLORS[a])
            cols.push(c.r, c.g, c.b, c.r, c.g, c.b)
          }
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
        geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
        scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35 })))
      }
      const holder = new THREE.Group()
      if (tr.rot) holder.add(triad(isAction ? axisLen * 0.8 : axisLen, { opacity: isAction ? 0.45 : 1 }))
      const ball = new THREE.Mesh(new THREE.SphereGeometry(axisLen * (isAction ? 0.12 : 0.18), 16, 12), new THREE.MeshBasicMaterial({ color, transparent: isAction, opacity: isAction ? 0.5 : 1 }))
      holder.add(ball)
      if (!isAction) {
        const lab = textSprite(it.label, it.color, 44)
        lab.position.set(0, 0, axisLen * 1.4)
        if (upAxis === 'y') lab.position.set(0, axisLen * 1.4, 0)
        lab.scale.set(axisLen * 0.45 * lab.userData.aspect, axisLen * 0.45, 1)
        holder.add(lab)
      }
      scene.add(holder)
      // action-chunk preview: the next H frames from the current one
      let chunk: THREE.Line | null = null
      if (horizon > 0 && tr.pos) {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.Float32BufferAttribute(new Array((horizon + 1) * 3).fill(0), 3))
        chunk = new THREE.Line(g, new THREE.LineBasicMaterial({ color: isAction ? 0xffe066 : 0xffffff, transparent: true, opacity: isAction ? 0.95 : 0.8, depthTest: false }))
        chunk.renderOrder = 5
        scene.add(chunk)
      }
      live.push({
        update: (f) => {
          if (chunk && tr.pos) {
            const arr = chunk.geometry.attributes.position.array as Float32Array
            let last = posAt(tr, f)
            for (let k = 0; k <= horizon; k++) {
              const p = posAt(tr, Math.min(tr.length - 1, f + k)) ?? last
              if (p) arr.set(p, k * 3)
              last = p
            }
            chunk.geometry.attributes.position.needsUpdate = true
            chunk.geometry.computeBoundingSphere()
          }
          setPose(holder, posAt(tr, f), rotAt(tr, f))
          if (!tr.pos) holder.position.set(0, 0, 0)
          if (it.gripper) {
            const g = it.gripper[f]
            const mat = ball.material as THREE.MeshBasicMaterial
            if (Number.isFinite(g)) mat.color.setRGB(1 - g * 0.7, 0.3 + g * 0.65, 0.35)
            ball.scale.setScalar(0.7 + 0.6 * (Number.isFinite(g) ? g : 0.5))
          }
        },
      })
    }
    visible.tracks.forEach((t) => makeTrack(t, false))
    visible.actions.forEach((t) => makeTrack(t, true))

    // camera frustums
    for (const c of visible.cameras) {
      const g = new THREE.Group()
      g.add(triad(axisLen * 0.7, { opacity: 0.9 }))
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(16 * 3).fill(0), 3))
      const fr = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xe3b341 }))
      g.add(fr)
      const lab = textSprite(c.cam.name, '#e3b341', 40)
      lab.scale.set(axisLen * 0.4 * lab.userData.aspect, axisLen * 0.4, 1)
      lab.position.set(0, -axisLen * 0.5, 0)
      g.add(lab)
      scene.add(g)
      const w = c.cam.width ?? 640
      const h = c.cam.height ?? 480
      const depth = axisLen * 2.2
      live.push({
        update: (f) => {
          setPose(g, posAt(c.track, f), rotAt(c.track, f))
          const K = c.K(f) ?? [w, w, w / 2, h / 2]
          const [fx, fy, cx, cy] = K
          const conv = c.cam.convention
          const corner = (u: number, v: number) => {
            let x = ((u - cx) / fx) * depth
            let y = ((v - cy) / fy) * depth
            let z = depth
            if (conv === 'opengl') (y = -y), (z = -z)
            else if (conv === 'ros_body') return [z, -x, -y]
            return [x, y, z]
          }
          const cs = [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)]
          const arr = geo.attributes.position.array as Float32Array
          let k = 0
          const put = (p: number[]) => {
            arr[k++] = p[0]
            arr[k++] = p[1]
            arr[k++] = p[2]
          }
          for (let i = 0; i < 4; i++) {
            put([0, 0, 0])
            put(cs[i])
            put(cs[i])
            put(cs[(i + 1) % 4])
          }
          geo.attributes.position.needsUpdate = true
        },
      })
    }

    // human skeleton
    if (visible.skeleton) {
      const sk = visible.skeleton
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(sk.bones.length * 6).fill(0), 3))
      scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xd2a8ff })))
      const pgeo = new THREE.BufferGeometry()
      pgeo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(sk.tracks.length * 3).fill(0), 3))
      scene.add(new THREE.Points(pgeo, new THREE.PointsMaterial({ color: 0xffffff, size: axisLen * 0.12 })))
      live.push({
        update: (f) => {
          const arr = geo.attributes.position.array as Float32Array
          sk.bones.forEach(([i, j], b) => {
            const a = posAt(sk.tracks[i], f) ?? [0, 0, 0]
            const c = posAt(sk.tracks[j], f) ?? a
            arr.set([...a, ...c], b * 6)
          })
          geo.attributes.position.needsUpdate = true
          const parr = pgeo.attributes.position.array as Float32Array
          sk.tracks.forEach((tr, i) => parr.set(posAt(tr, f) ?? [0, 0, 0], i * 3))
          pgeo.attributes.position.needsUpdate = true
        },
      })
    }

    // URDF robot driven by joint angles (forward kinematics)
    if (visible.robot) {
      const rb = visible.robot
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(rb.bones.length * 6).fill(0), 3))
      scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9ecbff })))
      const jgeo = new THREE.BufferGeometry()
      jgeo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(rb.bones.length * 3).fill(0), 3))
      scene.add(new THREE.Points(jgeo, new THREE.PointsMaterial({ color: 0xffffff, size: axisLen * 0.15 })))
      const tips = rb.leaves.map((l) => {
        const g = triad(axisLen * 0.6)
        const lab = textSprite(l, '#9ecbff', 36)
        lab.position.set(0, 0, axisLen * 0.9)
        lab.scale.set(axisLen * 0.35 * lab.userData.aspect, axisLen * 0.35, 1)
        g.add(lab)
        scene.add(g)
        return { link: l, g }
      })
      const trail: number[] = []
      const tipTrailGeo = new THREE.BufferGeometry()
      for (let t = 0; t < model.length; t += Math.max(1, Math.floor(model.length / 300))) {
        const T = rb.fk(t)
        for (const l of rb.leaves) {
          const m = T.get(l)
          if (m) trail.push(m[3], m[7], m[11])
        }
      }
      tipTrailGeo.setAttribute('position', new THREE.Float32BufferAttribute(trail, 3))
      if (showTrail) scene.add(new THREE.Points(tipTrailGeo, new THREE.PointsMaterial({ color: 0x4d8dff, size: axisLen * 0.06, transparent: true, opacity: 0.5 })))
      live.push({
        update: (f) => {
          const T = rb.fk(f)
          const arr = geo.attributes.position.array as Float32Array
          const jarr = jgeo.attributes.position.array as Float32Array
          rb.bones.forEach(([p, c], i) => {
            const a = T.get(p), b = T.get(c)
            if (!a || !b) return
            arr.set([a[3], a[7], a[11], b[3], b[7], b[11]], i * 6)
            jarr.set([b[3], b[7], b[11]], i * 3)
          })
          geo.attributes.position.needsUpdate = true
          jgeo.attributes.position.needsUpdate = true
          for (const { link, g } of tips) {
            const m = T.get(link)
            if (m) setPose(g, [m[3], m[7], m[11]], [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]])
          }
        },
      })
    }

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()
    let raf = 0
    let dirty = true
    const render = () => {
      raf = requestAnimationFrame(render)
      const moved = controls.update()
      if (moved || dirty) {
        renderer.render(scene, camera)
        dirty = false
      }
    }
    const apply = (f: number) => {
      for (const l of live) l.update(f)
      dirty = true
    }
    apply(playback.frame)
    const unsub = playback.subscribe(apply)
    controls.addEventListener('change', () => (dirty = true))
    render()
    return () => {
      cancelAnimationFrame(raf)
      unsub()
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      scene.traverse((o: any) => {
        o.geometry?.dispose?.()
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
        for (const m of mats) {
          m.map?.dispose?.()
          m.dispose?.()
        }
      })
      el.removeChild(renderer.domElement)
    }
  }, [visible, upAxis, ghosts, showTrail, frame, horizon])

  return (
    <div className="scene3d" ref={host}>
      <div className="hud">
        <span className="legend-axis">
          <b>X</b>
          <b>Y</b>
          <b>Z</b>
        </span>{' '}
        · {L('frame', '参考系')} <span className="mono">{frame}</span> · {visible.tracks.length} {L('poses', '个位姿')}
        {visible.skeleton ? ` · ${visible.skeleton.tracks.length} ${L('keypoints', '个关键点')}` : ''}
        {visible.robot ? ` · URDF ${visible.robot.name}` : ''}
        {!visible.tracks.length && !visible.skeleton && !visible.robot && <div style={{ color: 'var(--warn)' }}>{L('No poses in this frame', '该参考系下没有位姿数据')}</div>}
      </div>
      <div className="ctl">
        {model.frames.length > 1 && (
          <select className="small seg-select" value={frame} onChange={(e) => setFrame(e.target.value)} title={L('reference frame', '参考坐标系')}>
            {model.frames.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        )}
        <select
          className="small seg-select"
          value={horizon}
          onChange={(e) => updateSettings((s) => ({ ...s, chunkHorizon: Number(e.target.value) }))}
          title={L('Action-chunk preview: highlight the next H frames', 'Action chunk 预览：高亮未来 H 帧')}
        >
          {[0, 8, 16, 32, 50, 100].map((h) => (
            <option key={h} value={h}>
              {h ? `chunk H=${h}` : L('chunk off', 'chunk 关')}
            </option>
          ))}
        </select>
        <div style={{ position: 'relative' }}>
          <button className="small" onClick={() => setMenu((v) => !v)} title={L('Display options', '显示选项')}>
            ⚙ {L('Display', '显示')}
          </button>
          {menu && (
            <div className="panel" style={{ position: 'absolute', right: 0, top: 26, zIndex: 5, padding: 8, width: 180 }} onMouseLeave={() => setMenu(false)}>
              <div className="col small" style={{ gap: 6 }}>
                <label className="row">
                  {L('Up axis', '竖直轴')}
                  <span className="spacer" />
                  <select className="small seg-select" value={upAxis} onChange={(e) => updateSettings((s) => ({ ...s, upAxis: e.target.value as 'z' | 'y' }))}>
                    <option value="z">Z-up</option>
                    <option value="y">Y-up</option>
                  </select>
                </label>
                <label className="row">
                  <input type="checkbox" checked={showTrail} onChange={() => setShowTrail((v) => !v)} /> {L('Trajectory', '轨迹')}
                </label>
                <label className="row">
                  <input type="checkbox" checked={ghosts} onChange={() => updateSettings((s) => ({ ...s, showGhostFrames: !s.showGhostFrames }))} /> {L('Orientation ghosts', '姿态残影')}
                </label>
                {model.actionTracks.length > 0 && (
                  <label className="row">
                    <input type="checkbox" checked={showAction} onChange={() => setShowAction((v) => !v)} /> {L('Action targets', '动作目标')}
                  </label>
                )}
                {model.cameras.length > 0 && (
                  <label className="row">
                    <input type="checkbox" checked={showCams} onChange={() => setShowCams((v) => !v)} /> {L('Cameras', '相机')}
                  </label>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
