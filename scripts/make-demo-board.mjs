// Generates a small, realistic 2-layer KiCad-style fabrication set used by tests and demos.
// Board: 50 x 30 mm, an 8-pin DIP footprint, a 2-pin header, resistors, tracks on both sides, vias.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2] ?? 'fixtures/boards/demo-kicad'
mkdirSync(out, { recursive: true })
const f = (v) => Math.round(v * 1e6).toString() // 4.6 format, mm

const header = (fn, polarity = 'Positive') => [
  '%TF.GenerationSoftware,KiCad,Pcbnew,8.0.0*%',
  `%TF.FileFunction,${fn}*%`,
  `%TF.FilePolarity,${polarity}*%`,
  '%FSLAX46Y46*%',
  'G04 Gerber Fmt 4.6, Leading zero omitted, Abs format (unit mm)*',
  '%MOMM*%',
  '%LPD*%',
  'G01*'
]

// footprint data (mm)
const dip = [] // 8 pins, 2.54 pitch, rows 7.62 apart
for (let i = 0; i < 4; i++)
  dip.push({ x: 20 + i * 2.54, y: 10, net: `N${i}` }, { x: 20 + i * 2.54, y: 17.62, net: `N${i + 4}` })
const header2 = [
  { x: 6, y: 12, net: 'N0' },
  { x: 6, y: 14.54, net: 'GND' }
]
const smd = [
  { x: 38, y: 10, net: 'N4' },
  { x: 40.2, y: 10, net: 'N1' },
  { x: 38, y: 20, net: 'N5' },
  { x: 40.2, y: 20, net: 'GND' }
]
const vias = [
  { x: 32, y: 6, net: 'N2' },
  { x: 14, y: 22, net: 'N3' },
  { x: 44, y: 25, net: 'GND' }
]

const topTracks = [
  {
    w: 0.25,
    net: 'N0',
    pts: [
      [6, 12],
      [12, 12],
      [14, 10],
      [20, 10]
    ]
  },
  {
    w: 0.25,
    net: 'N1',
    pts: [
      [22.54, 10],
      [22.54, 7],
      [36, 7],
      [40.2, 10]
    ]
  },
  {
    w: 0.4,
    net: 'N4',
    pts: [
      [20, 17.62],
      [20, 13.5],
      [30, 13.5],
      [35, 10],
      [38, 10]
    ]
  },
  {
    w: 0.25,
    net: 'N5',
    pts: [
      [22.54, 17.62],
      [24, 19.5],
      [36, 19.5],
      [38, 20]
    ]
  },
  {
    w: 0.25,
    net: 'N2',
    pts: [
      [25.08, 10],
      [27, 8],
      [30, 6],
      [32, 6]
    ]
  }
]
const botTracks = [
  {
    w: 0.3,
    net: 'N3',
    pts: [
      [27.62, 10],
      [27.62, 12.5],
      [16, 22],
      [14, 22]
    ]
  },
  {
    w: 0.5,
    net: 'GND',
    pts: [
      [6, 14.54],
      [6, 25],
      [44, 25]
    ]
  },
  {
    w: 0.25,
    net: 'N6',
    pts: [
      [25.08, 17.62],
      [25.08, 21],
      [33, 21]
    ]
  }
]

function copper(side) {
  const L = header(side === 'top' ? 'Copper,L1,Top' : 'Copper,L2,Bot')
  L.push('%TA.AperFunction,ComponentPad*%', '%ADD10C,1.600000*%', '%ADD11R,1.600000X1.600000*%', '%TD*%')
  L.push('%TA.AperFunction,SMDPad,CuDef*%', '%ADD12R,1.200000X1.400000*%', '%TD*%')
  L.push('%TA.AperFunction,ViaPad*%', '%ADD13C,0.800000*%', '%TD*%')
  L.push(
    '%TA.AperFunction,Conductor*%',
    '%ADD14C,0.250000*%',
    '%ADD15C,0.400000*%',
    '%ADD16C,0.300000*%',
    '%ADD17C,0.500000*%',
    '%TD*%'
  )
  const ap = { 0.25: 'D14', 0.4: 'D15', 0.3: 'D16', 0.5: 'D17' }
  for (const t of side === 'top' ? topTracks : botTracks) {
    L.push(`%TO.N,${t.net}*%`, `${ap[t.w]}*`)
    t.pts.forEach(([x, y], i) => L.push(`X${f(x)}Y${f(y)}D0${i ? 1 : 2}*`))
    L.push('%TD*%')
  }
  dip.forEach((p, i) => {
    L.push(
      `%TO.N,${p.net}*%`,
      `%TO.C,U1*%`,
      `%TO.P,U1,${i + 1}*%`,
      i === 0 ? 'D11*' : 'D10*',
      `X${f(p.x)}Y${f(p.y)}D03*`,
      '%TD*%'
    )
  })
  header2.forEach((p, i) =>
    L.push(`%TO.N,${p.net}*%`, `%TO.C,J1*%`, i === 0 ? 'D11*' : 'D10*', `X${f(p.x)}Y${f(p.y)}D03*`, '%TD*%')
  )
  if (side === 'top')
    smd.forEach((p) => L.push(`%TO.N,${p.net}*%`, 'D12*', `X${f(p.x)}Y${f(p.y)}D03*`, '%TD*%'))
  vias.forEach((p) => L.push(`%TO.N,${p.net}*%`, 'D13*', `X${f(p.x)}Y${f(p.y)}D03*`, '%TD*%'))
  if (side === 'bottom') {
    // a small ground pour with a clearance hole
    L.push(
      '%TO.N,GND*%',
      'G36*',
      `X${f(36)}Y${f(23)}D02*`,
      `X${f(48)}Y${f(23)}D01*`,
      `X${f(48)}Y${f(28)}D01*`,
      `X${f(36)}Y${f(28)}D01*`,
      `X${f(36)}Y${f(23)}D01*`,
      'G37*',
      '%TD*%'
    )
  }
  L.push('M02*')
  return L.join('\n') + '\n'
}

function mask(side) {
  const L = header(side === 'top' ? 'Soldermask,Top' : 'Soldermask,Bot', 'Negative')
  L.push('%ADD10C,1.700000*%', '%ADD11R,1.700000X1.700000*%', '%ADD12R,1.300000X1.500000*%')
  dip.forEach((p, i) => L.push(i === 0 ? 'D11*' : 'D10*', `X${f(p.x)}Y${f(p.y)}D03*`))
  header2.forEach((p, i) => L.push(i === 0 ? 'D11*' : 'D10*', `X${f(p.x)}Y${f(p.y)}D03*`))
  if (side === 'top') smd.forEach((p) => L.push('D12*', `X${f(p.x)}Y${f(p.y)}D03*`))
  L.push('M02*')
  return L.join('\n') + '\n'
}

function silk() {
  const L = header('Legend,Top')
  L.push('%ADD10C,0.150000*%', 'D10*')
  const rect = (x0, y0, x1, y1) =>
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0]
    ].forEach(([x, y], i) => L.push(`X${f(x)}Y${f(y)}D0${i ? 1 : 2}*`))
  rect(18.8, 11.5, 28.8, 16.1)
  rect(4.6, 10.6, 7.4, 15.9)
  rect(36.9, 9, 41.3, 11)
  rect(36.9, 19, 41.3, 21)
  // "notch" arc on the DIP outline
  L.push('G75*', `X${f(18.8)}Y${f(13.3)}D02*`, 'G03*', `X${f(18.8)}Y${f(14.3)}I${f(0)}J${f(0.5)}D01*`, 'G01*')
  L.push('M02*')
  return L.join('\n') + '\n'
}

function outline() {
  const L = header('Profile,NP')
  L.push('%TA.AperFunction,Profile*%', '%ADD10C,0.100000*%', '%TD*%', 'D10*')
  const r = 2
  L.push(
    `X${f(r)}Y${f(0)}D02*`,
    `X${f(50 - r)}Y${f(0)}D01*`,
    'G75*',
    'G03*',
    `X${f(50)}Y${f(r)}I${f(0)}J${f(r)}D01*`,
    'G01*'
  )
  L.push(`X${f(50)}Y${f(30 - r)}D01*`, 'G03*', `X${f(50 - r)}Y${f(30)}I${f(-r)}J${f(0)}D01*`, 'G01*')
  L.push(`X${f(r)}Y${f(30)}D01*`, 'G03*', `X${f(0)}Y${f(30 - r)}I${f(0)}J${f(-r)}D01*`, 'G01*')
  L.push(`X${f(0)}Y${f(r)}D01*`, 'G03*', `X${f(r)}Y${f(0)}I${f(r)}J${f(0)}D01*`, 'G01*')
  L.push('M02*')
  return L.join('\n') + '\n'
}

function drill(plated) {
  const L = [
    'M48',
    '; DRILL file {KiCad 8.0.0} date 2026-11-04',
    '; FORMAT={-:-/ absolute / metric / decimal}',
    `; #@! TF.FileFunction,${plated ? 'Plated,1,2,PTH' : 'NonPlated,1,2,NPTH'}`,
    'FMAT,2',
    'METRIC'
  ]
  if (plated) {
    L.push(
      '; #@! TA.AperFunction,Plated,PTH,ViaDrill',
      'T1C0.400',
      '; #@! TA.AperFunction,Plated,PTH,ComponentDrill',
      'T2C0.800',
      'T3C1.000',
      '%',
      'G90',
      'G05',
      'T1'
    )
    vias.forEach((v) => L.push(`X${v.x.toFixed(3)}Y${v.y.toFixed(3)}`))
    L.push('T2')
    dip.forEach((p) => L.push(`X${p.x.toFixed(3)}Y${p.y.toFixed(3)}`))
    L.push('T3')
    header2.forEach((p) => L.push(`X${p.x.toFixed(3)}Y${p.y.toFixed(3)}`))
  } else {
    L.push(
      '; #@! TA.AperFunction,NonPlated,NPTH,ComponentDrill',
      'T1C3.200',
      '%',
      'G90',
      'G05',
      'T1',
      'X4.000Y4.000',
      'X46.000Y4.000',
      'X4.000Y26.000'
    )
  }
  L.push('M30')
  return L.join('\n') + '\n'
}

const files = {
  'demo-F_Cu.gbr': copper('top'),
  'demo-B_Cu.gbr': copper('bottom'),
  'demo-F_Mask.gbr': mask('top'),
  'demo-B_Mask.gbr': mask('bottom'),
  'demo-F_Silkscreen.gbr': silk(),
  'demo-Edge_Cuts.gbr': outline(),
  'demo-PTH.drl': drill(true),
  'demo-NPTH.drl': drill(false),
  'demo-bom.csv': 'Ref,Value\nU1,NE555\nJ1,Header\n'
}
for (const [name, text] of Object.entries(files)) writeFileSync(join(out, name), text)
console.log(`wrote ${Object.keys(files).length} files to ${out}`)
