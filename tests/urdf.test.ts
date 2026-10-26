import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { autoJointMap, forwardKinematics, parseUrdf } from '../src/core/robot/urdf'

const URDF = `<?xml version="1.0"?>
<robot name="two_link">
  <link name="base"/><link name="l1"/><link name="l2"/><link name="tip"/>
  <joint name="shoulder" type="revolute">
    <parent link="base"/><child link="l1"/><origin xyz="0 0 0.1" rpy="0 0 0"/><axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="1" velocity="1"/>
  </joint>
  <joint name="elbow" type="revolute">
    <parent link="l1"/><child link="l2"/><origin xyz="0.5 0 0"/><axis xyz="0 0 1"/>
  </joint>
  <!-- fixed tool frame -->
  <joint name="tool" type="fixed"><parent link="l2"/><child link="tip"/><origin xyz="0.3 0 0"/></joint>
</robot>`

describe('urdf', () => {
  const m = parseUrdf(URDF)
  it('parses the kinematic tree', () => {
    expect(m.name).toBe('two_link')
    expect(m.root).toBe('base')
    expect(m.movable.map((j) => j.name)).toEqual(['shoulder', 'elbow'])
  })
  it('computes forward kinematics', () => {
    const T = forwardKinematics(m, new Map([['shoulder', Math.PI / 2], ['elbow', 0]]))
    const tip = T.get('tip')!
    // arm rotated 90° about z: tip at (0, 0.8, 0.1)
    expect(tip[3]).toBeCloseTo(0, 6)
    expect(tip[7]).toBeCloseTo(0.8, 6)
    expect(tip[11]).toBeCloseTo(0.1, 6)
  })
  const so101 = 'C:/Users/Administrator/Desktop/dataset_mainstream/_urdf/so101.urdf'
  it.skipIf(!existsSync(so101))('parses the SO-101 URDF and matches LeRobot motor names', () => {
    const r = parseUrdf(readFileSync(so101, 'utf8'))
    expect(r.movable.map((j) => j.name)).toEqual(['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'])
    const names = ['shoulder_pan.pos', 'shoulder_lift.pos', 'elbow_flex.pos', 'wrist_flex.pos', 'wrist_roll.pos', 'gripper.pos']
    const map = autoJointMap(r, names.map((n, i) => ({ id: `s#${i}`, name: n })))
    expect(Object.values(map)).toEqual(names.map((_, i) => `s#${i}`))
    const T = forwardKinematics(r, new Map())
    expect(T.size).toBe(r.links.length)
  })
  it('maps joints by name, then by order', () => {
    const map = autoJointMap(m, [
      { id: 'a', name: 'elbow_joint' },
      { id: 'b', name: 'motor_0' },
    ])
    expect(map).toEqual({ elbow: 'a', shoulder: 'b' })
  })
})
