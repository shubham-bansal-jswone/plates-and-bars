// Parametric figure rig ported from the prototype's AN (docs/prototype/plate-and-bar.html, "code-built exercise
// animations"): same joint maths, same output for the same colours. The first 31 poses in D are the prototype's, ported
// unchanged; later entries are our own additions (batch 2 onwards, #653). Changes from the prototype:
// ES module, the colour map is a parameter of frame(), and it is exported without the browser globals, and
// it adds joints(name, k), the side-view joint positions, used by the segment-length test.
// New poses are appended to D below; nothing else in the rig needs to change.
export const AN = (() => {
  const SEG = { torso:70, head:11, neck:15, ua:36, fa:32, th:50, sh:48, foot:15 };
  const W = { torso:26, th:17, sh:12, ua:11, fa:9, foot:7 };
  const rad = a => a * Math.PI / 180;
  const pt = (p, a, l) => [p[0] + l * Math.cos(rad(a)), p[1] + l * Math.sin(rad(a))];
  const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
  const lerp = (a, b, k) => a + (b - a) * k;
  function mix(a, b, k){
    const o = {};
    for(const key in a){
      const x = a[key], y = b[key] === undefined ? x : b[key];
      o[key] = Array.isArray(x) ? x.map((v, i) => lerp(v, y[i], k)) : typeof x === 'number' ? lerp(x, y, k) : x;
    }
    return o;
  }
  function ik(A, B, l1, l2, sign){
    const dx = B[0] - A[0], dy = B[1] - A[1];
    let d = Math.hypot(dx, dy); d = Math.max(Math.abs(l1 - l2) + 0.01, Math.min(l1 + l2 - 0.01, d));
    const base = Math.atan2(dy, dx), a = Math.acos((l1*l1 + d*d - l2*l2) / (2*l1*d));
    const ang = base + sign * a;
    return [A[0] + l1 * Math.cos(ang), A[1] + l1 * Math.sin(ang)];
  }
  const ln = (p, q, w, c, extra = '') => `<line x1="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" x2="${q[0].toFixed(1)}" y2="${q[1].toFixed(1)}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"${extra}/>`;
  const circ = (p, r, fill, extra = '') => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r}" fill="${fill}"${extra}/>`;
  // side of a segment: front = +1, back = -1. Limbs: rotate(dir, -90); torso: rotate(dir, +90)
  function band(p, q, w, side, isTorso, from, to, c){
    const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1, u = [dx/L, dy/L];
    let n = isTorso ? [-u[1], u[0]] : [u[1], -u[0]];
    n = [n[0]*side, n[1]*side];
    const off = w * 0.22, a = [p[0] + dx*from + n[0]*off, p[1] + dy*from + n[1]*off], b = [p[0] + dx*to + n[0]*off, p[1] + dy*to + n[1]*off];
    return ln(a, b, Math.max(4, w * 0.5), c);
  }

  function sideJoints(E, P){
    const J = {};
    if(E.root === 'toe'){
      J.toe = P.toe || E.toe; J.ankle = pt(J.toe, P.foot, SEG.foot); J.knee = pt(J.ankle, P.shin, SEG.sh); J.hip = pt(J.knee, P.thigh, SEG.th);
    } else if(E.root === 'ankle' && P.shin !== undefined){
      J.ankle = P.ankle || E.ankle; J.knee = pt(J.ankle, P.shin, SEG.sh); J.hip = pt(J.knee, P.thigh, SEG.th);
    } else {
      J.hip = P.hip || E.hip;
      if(P.ankle){ J.ankle = P.ankle; J.knee = ik(J.hip, J.ankle, SEG.th, SEG.sh, E.kb || -1); }
      else { J.knee = pt(J.hip, P.thigh, SEG.th); J.ankle = pt(J.knee, P.shinD, SEG.sh); }
    }
    J.toe = J.toe || pt(J.ankle, P.footA === undefined ? 0 : P.footA, SEG.foot);
    J.sh = pt(J.hip, P.torso, SEG.torso);
    J.head = pt(J.sh, P.torso + (P.neck || 0), SEG.neck + SEG.head);
    if(P.wrist || P.wristR){
      J.wr = P.wrist || add(J.sh, P.wristR);
      J.el = ik(J.sh, J.wr, SEG.ua * (P.uaS || 1), SEG.fa * (P.faS || 1), E.eb || 1);
    } else {
      const ua = P.uaR !== undefined ? P.torso + P.uaR : P.ua;
      const fa = P.faR !== undefined ? ua + P.faR : P.fa;
      J.el = pt(J.sh, ua, SEG.ua * (P.uaS || 1)); J.wr = pt(J.el, fa, SEG.fa * (P.faS || 1));
    }
    return J;
  }
  function drawSide(E, P, C){
    const J = sideJoints(E, P), H = new Set(E.hl || []);
    let s = '';
    if(E.props) s += E.props(J, P, C, { ln, circ, pt });
    const body = C.body, hl = C.hl;
    s += ln(J.ankle, J.toe, W.foot, body) + ln(J.ankle, J.knee, W.sh, body) + ln(J.knee, J.hip, W.th, body) + ln(J.hip, J.sh, W.torso, body);
    if(H.has('calves')) s += band(J.knee, J.ankle, W.sh, -1, false, .15, .55, hl);
    if(H.has('quads')) s += band(J.hip, J.knee, W.th, 1, false, .15, .85, hl);
    if(H.has('hams')) s += band(J.hip, J.knee, W.th, -1, false, .15, .85, hl);
    if(H.has('glutes')) { const g = band(J.hip, J.sh, W.torso, -1, true, 0, .12, hl); s += g; }
    if(H.has('abs')) s += band(J.hip, J.sh, W.torso, 1, true, .2, .55, hl);
    if(H.has('chest')) s += band(J.hip, J.sh, W.torso, 1, true, .66, .9, hl);
    if(H.has('back')) s += band(J.hip, J.sh, W.torso, -1, true, .45, .9, hl);
    if(H.has('shoulders')) s += circ(J.sh, 8, hl);
    if(H.has('rear')) { const d = [J.sh[0]-J.hip[0], J.sh[1]-J.hip[1]], L = Math.hypot(...d); s += circ([J.sh[0] + d[1]/L*7, J.sh[1] - d[0]/L*7], 7, hl); }
    s += circ(J.head, SEG.head, C.bg, ` stroke="${body}" stroke-width="5"`);
    s += ln(J.sh, J.el, W.ua, C.arm) + ln(J.el, J.wr, W.fa, C.arm);
    if(H.has('biceps')) s += band(J.sh, J.el, W.ua, 1, false, .2, .8, hl);
    if(H.has('triceps')) s += band(J.sh, J.el, W.ua, -1, false, .2, .8, hl);
    if(E.hand) s += E.hand(J, P, C, { ln, circ, pt });
    return s;
  }

  // front view
  function drawFront(E, P, C){
    const H = new Set(E.hl || []), body = C.body, hl = C.hl;
    const cx = 160, top = P.shY || 82, hipY = 150, seated = E.seated;
    const sR = [cx + 22, top], sL = [cx - 22, top];
    let s = '';
    if(E.props) s += E.props(null, P, C, { ln, circ, pt });
    if(seated){
      s += ln([148, hipY], [146, 168], 15, body) + ln([172, hipY], [174, 168], 15, body) + ln([146, 168], [146, 214], 11, body) + ln([174, 168], [174, 214], 11, body);
    } else {
      s += ln([148, hipY], [146, 214], 14, body) + ln([172, hipY], [174, 214], 14, body);
    }
    s += ln([cx, top + 6], [cx, hipY - 4], 30, body) + ln(sL, sR, 12, body);
    if(H.has('abs')) s += ln([cx, hipY - 40], [cx, hipY - 10], 12, hl);
    if(H.has('chest')) s += ln([cx - 12, top + 14], [cx - 4, top + 14], 10, hl) + ln([cx + 4, top + 14], [cx + 12, top + 14], 10, hl);
    if(H.has('back')) s += ln([cx - 15, top + 12], [cx - 13, top + 40], 6, hl) + ln([cx + 15, top + 12], [cx + 13, top + 40], 6, hl);
    const arm = (S, m, A) => {
      let el, wr;
      if(A.hz !== undefined){ // horizontal-plane arm, foreshortened
        el = [S[0] + m * SEG.ua * Math.cos(rad(A.hz)), S[1] + 4];
        wr = [el[0] + m * SEG.fa * Math.cos(rad(A.hz + (A.bend || 0))), el[1] + 2];
      } else if(A.wrist){
        const w = [cx + m * (A.wrist[0] - cx), A.wrist[1]];
        wr = w; el = ik(S, w, SEG.ua, SEG.fa, m * (E.eb || -1));
      } else {
        const ua = m > 0 ? A.ua : 180 - A.ua, fa = m > 0 ? A.fa : 180 - A.fa;
        el = pt(S, ua, SEG.ua); wr = pt(el, fa, SEG.fa);
      }
      let o = ln(S, el, 10, body) + ln(el, wr, 8, body);
      if(H.has('shoulders') && (!E.oneArm || m > 0)) o += circ(S, 7.5, hl);
      if(H.has('rear') && (!E.oneArm || m > 0)) o += circ(S, 7.5, hl);
      if(E.hand) o += E.hand({ S, el, wr, m }, P, C, { ln, circ, pt });
      return o;
    };
    s += arm(sR, 1, P);
    s += arm(sL, -1, P.left || P);
    s += circ([cx, top - (P.headUp || 28)], 12, C.bg, ` stroke="${body}" stroke-width="5"`);
    return s;
  }

  const floor = (C, a = 60, b = 260) => `<line x1="${a}" y1="226" x2="${b}" y2="226" stroke="${C.eq}" stroke-width="2"/>`;
  const seat = (C, x1, x2, y) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${C.eq}" stroke-width="8" stroke-linecap="round"/><line x1="${(x1+x2)/2}" y1="${y}" x2="${(x1+x2)/2}" y2="226" stroke="${C.eq}" stroke-width="4"/>`;
  const backPad = (J, C, g, extra = 6) => { const d = [J.sh[0]-J.hip[0], J.sh[1]-J.hip[1]], L = Math.hypot(...d), u = [d[0]/L, d[1]/L], n = [u[1], -u[0]];
    return g.ln([J.hip[0] + n[0]*17 - u[0]*10, J.hip[1] + n[1]*17 - u[1]*10], [J.sh[0] + n[0]*17 + u[0]*extra, J.sh[1] + n[1]*17 + u[1]*extra], 9, C.eq); };
  const chestPad = (J, C, g) => { const d = [J.sh[0]-J.hip[0], J.sh[1]-J.hip[1]], L = Math.hypot(...d), u = [d[0]/L, d[1]/L], n = [-u[1], u[0]];
    return g.ln([J.hip[0] + n[0]*18 + u[0]*30, J.hip[1] + n[1]*18 + u[1]*30], [J.sh[0] + n[0]*18 + u[0]*4, J.sh[1] + n[1]*18 + u[1]*4], 9, C.eq); };
  const db = (w, C, g, vert) => vert ? `<rect x="${(w[0]-4).toFixed(1)}" y="${(w[1]-9).toFixed(1)}" width="8" height="18" rx="2" fill="${C.eq}"/>` : `<rect x="${(w[0]-9).toFixed(1)}" y="${(w[1]-4).toFixed(1)}" width="18" height="8" rx="2" fill="${C.eq}"/>`;
  const grip = (w, C, g) => g.circ(w, 5, 'none', ` stroke="${C.eq}" stroke-width="3"`);
  const cable = (w, p, C, g) => g.ln(w, p, 1.5, C.eq) + g.circ(p, 5, C.eq);

  // Rear legs drawn in props: ik from the hip to a fixed rear foot, so they keep thigh and shin length (joints() exposes them to the test).
  const splitRear = (J, P) => { const ra = [P.rx, 205]; return [J.hip, ik(J.hip, ra, SEG.th, SEG.sh, -1), ra]; };
  const bulgarianRear = (J) => { const rf = [78, 170]; return [J.hip, ik(J.hip, rf, SEG.th, SEG.sh, -1), rf]; };
  // Rear or free legs drawn in props (ik or a fixed angle from the hip, so thigh and shin keep their length; joints() exposes them to the test).
  // Walking lunge: the rear toe stays put, the heel lifts (heel 180 = foot flat, behind the front leg at the start; both legs coincide there).
  const lungeRear = (J, P) => { const T = [107,212], a = pt(T, P.heel, SEG.foot); return [J.hip, ik(J.hip, a, SEG.th, SEG.sh, -1), a, T]; };
  const bridgeFree = (J) => { const k = pt(J.hip, -30, SEG.th); return [J.hip, k, pt(k, -30, SEG.sh)]; };
  const calfFree = (J) => { const k = pt(J.hip, 100, SEG.th); return [J.hip, k, pt(k, 175, SEG.sh)]; };
  const freeLegs = (leg, J, C, g, foot) => { const [h, k, a] = leg(J);
    return g.ln(h,k,13,C.body) + g.ln(k,a,9,C.body) + g.ln(a,g.pt(a,foot,11),7,C.body); };
  const STAND = { ankle:[150,212] };
  // Isometric holds: one pose, used for both start and end (the plank's body line is straight, elbows under the shoulders).
  const PLANK = { foot:-60, shin:-9.25, thigh:-9.25, torso:-9.25, neck:6, ua:90, fa:0 };
  const BALANCE = { foot:180, shin:-90, thigh:-90, torso:-90, ua:93, fa:90 };
  const WALL_SIT = { thigh:0, shinD:90, torso:-90, footA:0, ua:75, fa:75 };
  const D = {
    'Machine Chest Press': { hip:[130,168], eb:-1, hl:['chest','triceps'],
      a:{ ankle:[178,214], torso:-95, wrist:[136,108], uaS:.75 }, b:{ ankle:[178,214], torso:-95, wrist:[188,104] },
      props:(J,P,C,g) => floor(C) + seat(C,100,160,178) + backPad(J,C,g) + g.ln(J.wr,[220,40],5,C.eq), hand:(J,P,C,g) => grip(J.wr,C,g) },
    'Incline Dumbbell Press': { hip:[185,160], eb:1, hl:['chest','shoulders'],
      a:{ ankle:[232,214], torso:-150, wrist:[138,112], uaS:.7 }, b:{ ankle:[232,214], torso:-150, wrist:[132,58] },
      props:(J,P,C,g) => floor(C) + backPad(J,C,g,22) + g.ln([150,172],[150,226],4,C.eq) + g.ln([200,175],[200,226],4,C.eq), hand:(J,P,C,g) => db(J.wr,C,g) },
    'Seated Dumbbell Press': { front:true, seated:true, eb:1, hl:['shoulders','triceps'],
      a:{ wrist:[202,58] }, b:{ wrist:[176,10] },
      props:(J,P,C) => floor(C,90,230) + seat(C,120,200,156) + `<rect x="140" y="78" width="40" height="76" rx="4" fill="${C.eq}"/>`, hand:(A,P,C,g) => db(A.wr,C,g,false) },
    'Lateral Raise': { front:true, hl:['shoulders'],
      a:{ ua:82, fa:90 }, b:{ ua:4, fa:14 }, props:(J,P,C) => floor(C,90,230), hand:(A,P,C,g) => db(A.wr,C,g,true) },
    'Rope Pushdown': { root:'ankle', ankle:[140,212], hl:['triceps'],
      a:{ shin:-90, thigh:-92, torso:-80, ua:96, fa:-15 }, b:{ shin:-90, thigh:-92, torso:-80, ua:96, fa:95 },
      props:(J,P,C,g) => floor(C) + g.ln([215,8],[215,226],4,C.eq) + cable(J.wr,[200,10],C,g), hand:(J,P,C,g) => grip(J.wr,C,g) },
    'Lat Pulldown': { hip:[150,165], hl:['back','biceps'],
      a:{ thigh:0, shinD:95, torso:-100, ua:-75, fa:-80 }, b:{ thigh:0, shinD:95, torso:-105, ua:105, fa:-60 },
      props:(J,P,C,g) => floor(C) + seat(C,118,182,175) + g.ln([196,150],[214,150],8,C.eq) + g.ln([240,8],[240,226],4,C.eq) + g.ln([150,8],[240,8],4,C.eq) + cable(J.wr,[150,10],C,g),
      hand:(J,P,C,g) => g.circ(J.wr, 5, 'none', ` stroke="${C.eq}" stroke-width="3"`) },
    'Seated Cable Row': { hip:[100,192], eb:1, kb:-1, hl:['back','biceps'],
      a:{ ankle:[196,204], torso:-78, wrist:[180,128] }, b:{ ankle:[196,204], torso:-100, wrist:[118,152] },
      props:(J,P,C,g) => floor(C,40,300) + seat(C,60,130,202) + g.ln([210,190],[204,222],6,C.eq) + cable(J.wr,[290,196],C,g), hand:(J,P,C,g) => grip(J.wr,C,g) },
    'Face Pull': { root:'ankle', ankle:[140,212], eb:-1, hl:['rear','shoulders'],
      a:{ shin:-90, thigh:-90, torso:-92, ua:-12, fa:-8 }, b:{ shin:-90, thigh:-90, torso:-92, ua:-160, fa:-20 },
      props:(J,P,C,g) => floor(C) + g.ln([300,8],[300,226],4,C.eq) + cable(J.wr,[292,36],C,g), hand:(J,P,C,g) => grip(J.wr,C,g) },
    'Dumbbell Curl': { root:'ankle', ankle:[150,212], hl:['biceps'],
      a:{ shin:-90, thigh:-90, torso:-90, ua:93, fa:90 }, b:{ shin:-90, thigh:-90, torso:-90, ua:96, fa:-62 },
      props:(J,P,C) => floor(C), hand:(J,P,C,g) => db(J.wr,C,g,false) },
    'Hammer Curl': { root:'ankle', ankle:[150,212], hl:['biceps'],
      a:{ shin:-90, thigh:-90, torso:-90, ua:93, fa:90 }, b:{ shin:-90, thigh:-90, torso:-90, ua:96, fa:-62 },
      props:(J,P,C) => floor(C), hand:(J,P,C,g) => db(J.wr,C,g,true) },
    'Hack Squat': { root:'ankle', ankle:[185,212], hl:['quads','glutes'],
      a:{ shin:-100, thigh:-97, torso:-115, ua:120, fa:-30 }, b:{ shin:-55, thigh:-175, torso:-118, ua:120, fa:-30 },
      props:(J,P,C,g) => g.ln([150,222],[250,222],5,C.eq) + g.ln([60,232],[240,104],3,C.eq) + backPad(J,C,g) },
    'Leg Press': { hip:[110,170], kb:-1, hl:['quads','glutes'],
      a:{ ankle:[156,131], torso:-160, ua:60, fa:5, footA:-40 }, b:{ ankle:[185,107], torso:-160, ua:60, fa:5, footA:-40 },
      props:(J,P,C,g) => floor(C,30,280) + backPad(J,C,g,10) + g.ln([90,190],[60,226],4,C.eq) + g.ln(g.pt(J.ankle,130,22),g.pt(J.ankle,-50,30),7,C.eq) + g.ln([150,150],[260,58],3,C.eq) },
    'Lying Leg Curl': { hip:[170,150], hl:['hams'],
      a:{ torso:0, thigh:180, shinD:180, ua:100, fa:60, footA:180 }, b:{ torso:0, thigh:180, shinD:280, ua:100, fa:60, footA:180 },
      props:(J,P,C,g) => floor(C,30,300) + g.ln([60,166],[250,166],8,C.eq) + g.ln([155,166],[155,226],4,C.eq), hand:(J,P,C,g) => grip(J.wr,C,g) + g.circ(g.pt(J.ankle, P.shinD + 90, 9), 6, C.eq) },
    'Leg Extension': { hip:[150,165], hl:['quads'],
      a:{ torso:-95, thigh:0, shinD:95, ua:95, fa:20 }, b:{ torso:-95, thigh:0, shinD:5, ua:95, fa:20 },
      props:(J,P,C,g) => floor(C) + seat(C,118,195,176) + backPad(J,C,g), hand:(J,P,C,g) => g.circ(g.pt(J.ankle, P.shinD + 90, 9), 6, C.eq) },
    'Standing Calf Raise': { root:'toe', toe:[190,212], hl:['calves'],
      a:{ foot:162, shin:-90, thigh:-90, torso:-90, ua:70, fa:-95 }, b:{ foot:215, shin:-90, thigh:-90, torso:-90, ua:70, fa:-95 },
      props:(J,P,C,g) => floor(C) + `<rect x="168" y="216" width="50" height="10" fill="${C.eq}"/>` + g.ln([J.sh[0]-14,J.sh[1]-8],[J.sh[0]+14,J.sh[1]-8],8,C.eq) + g.ln([J.sh[0],J.sh[1]-8],[J.sh[0],8],4,C.eq) },
    'Cable Crunch': { root:'ankle', ankle:[90,214], hl:['abs'],
      a:{ shin:0, thigh:-90, torso:-78, uaR:15, faR:165, footA:180 }, b:{ shin:0, thigh:-90, torso:-28, uaR:15, faR:165, footA:180 },
      props:(J,P,C,g) => floor(C,40,300) + g.ln([260,8],[260,226],4,C.eq) + cable(J.wr,[250,10],C,g) },
    'Barbell Bench Press': { hip:[190,165], eb:1, kb:-1, hl:['chest','triceps'],
      a:{ ankle:[232,222], torso:180, wrist:[126,150], uaS:.55 }, b:{ ankle:[232,222], torso:180, wrist:[124,96] },
      props:(J,P,C,g) => floor(C,40,290) + g.ln([92,180],[210,180],9,C.eq) + g.ln([150,180],[150,226],4,C.eq) + g.ln([108,226],[108,92],4,C.eq) + g.ln([108,92],[118,92],4,C.eq),
      hand:(J,P,C,g) => g.circ(J.wr, 6, C.eq) },
    'Machine Shoulder Press': { front:true, seated:true, eb:1, hl:['shoulders','triceps'],
      a:{ wrist:[204,62] }, b:{ wrist:[180,14] },
      props:(J,P,C) => floor(C,90,230) + seat(C,120,200,156) + `<rect x="140" y="78" width="40" height="76" rx="4" fill="${C.eq}"/>`, hand:(A,P,C,g) => g.ln([A.wr[0]-9,A.wr[1]],[A.wr[0]+9,A.wr[1]],6,C.eq) },
    'Pec Deck Fly': { front:true, seated:true, hl:['chest'],
      a:{ hz:0, bend:12 }, b:{ hz:100, bend:22 },
      props:(J,P,C) => floor(C,90,230) + seat(C,120,200,156) + `<rect x="140" y="78" width="40" height="76" rx="4" fill="${C.eq}"/>`, hand:(A,P,C,g) => g.ln([A.wr[0],A.wr[1]-10],[A.wr[0],A.wr[1]+10],6,C.eq) },
    'Cable Lateral Raise': { front:true, oneArm:true, hl:['shoulders'],
      a:{ ua:100, fa:118, left:{ ua:96, fa:92 } }, b:{ ua:3, fa:10, left:{ ua:96, fa:92 } },
      props:(J,P,C) => floor(C,60,260) + `<line x1="76" y1="226" x2="76" y2="60" stroke="${C.eq}" stroke-width="4"/>`,
      hand:(A,P,C,g) => A.m > 0 ? cable(A.wr,[80,218],C,g) : '' },
    'Overhead Cable Extension': { root:'ankle', ankle:[150,212], hl:['triceps'],
      a:{ shin:-80, thigh:-95, torso:-65, ua:-48, fa:140 }, b:{ shin:-80, thigh:-95, torso:-65, ua:-48, fa:312 },
      props:(J,P,C,g) => floor(C,20,300) + g.ln([30,40],[30,226],4,C.eq) + cable(J.wr,[36,190],C,g), hand:(J,P,C,g) => grip(J.wr,C,g) },
    'Chest-Supported Row': { hip:[120,172], eb:-1, hl:['back','rear'],
      a:{ ankle:[176,214], torso:-68, wrist:[200,150] }, b:{ ankle:[176,214], torso:-68, wrist:[150,118] },
      props:(J,P,C,g) => floor(C) + seat(C,92,150,182) + chestPad(J,C,g), hand:(J,P,C,g) => grip(J.wr,C,g) },
    'Assisted Pull-up': { hl:['back','biceps'], eb:-1,
      a:{ hip:[150,168], torso:-95, wrist:[156,34], thigh:95, shinD:182, footA:180 }, b:{ hip:[150,118], torso:-95, wrist:[156,34], thigh:95, shinD:182, footA:180 },
      props:(J,P,C,g) => g.ln([100,30],[240,30],5,C.eq) + g.ln([100,30],[100,226],4,C.eq) + g.ln([J.knee[0]-34,J.knee[1]+11],[J.knee[0]+10,J.knee[1]+11],8,C.eq) + g.ln([100,J.knee[1]+11],[J.knee[0]-34,J.knee[1]+11],3,C.eq) + floor(C,60,260) },
    'One-Arm Dumbbell Row': { hip:[110,142], eb:-1, kb:-1, hl:['back','biceps'],
      a:{ ankle:[132,214], torso:-6, wrist:[184,200] }, b:{ ankle:[132,214], torso:-6, wrist:[140,150] },
      props:(J,P,C,g) => floor(C,40,290) + g.ln([150,176],[270,176],9,C.eq) + g.ln([210,176],[210,226],4,C.eq) + g.ln([J.sh[0]+10,J.sh[1]+6],[J.sh[0]+30,176],8,C.body), hand:(J,P,C,g) => db(J.wr,C,g,false) },
    'Rear Delt Fly': { front:true, seated:true, hl:['rear'],
      a:{ shY:118, headUp:16, ua:84, fa:88 }, b:{ shY:118, headUp:16, ua:6, fa:12 },
      props:(J,P,C) => floor(C,90,230) + seat(C,120,200,160), hand:(A,P,C,g) => db(A.wr,C,g,true) },
    'Cable Curl': { root:'ankle', ankle:[150,212], hl:['biceps'],
      a:{ shin:-90, thigh:-90, torso:-90, ua:93, fa:88 }, b:{ shin:-90, thigh:-90, torso:-90, ua:96, fa:-62 },
      props:(J,P,C,g) => floor(C) + g.ln([215,60],[215,226],4,C.eq) + cable(J.wr,[208,218],C,g), hand:(J,P,C,g) => grip(J.wr,C,g) },
    'Goblet Squat': { kb:-1, eb:1, hl:['quads','glutes'],
      a:{ hip:[146,114], ankle:[150,212], torso:-90, wristR:[18,6] }, b:{ hip:[118,168], ankle:[150,212], torso:-66, wristR:[18,6] },
      props:(J,P,C) => floor(C), hand:(J,P,C,g) => db(J.wr,C,g,true) },
    'Seated Leg Curl': { hip:[150,165], hl:['hams'],
      a:{ torso:-100, thigh:0, shinD:5, ua:95, fa:20 }, b:{ torso:-100, thigh:0, shinD:118, ua:95, fa:20 },
      props:(J,P,C,g) => floor(C) + seat(C,118,195,176) + backPad(J,C,g) + g.ln([J.knee[0]-24,J.knee[1]-12],[J.knee[0]+2,J.knee[1]-12],8,C.eq), hand:(J,P,C,g) => g.circ(g.pt(J.ankle, P.shinD - 90, 9), 6, C.eq) },
    'Hip Thrust': { kb:-1, hl:['glutes','hams'],
      a:{ hip:[145,204], ankle:[205,214], torso:230, ua:60, fa:10 }, b:{ hip:[170,150], ankle:[205,214], torso:180, ua:60, fa:10 },
      props:(J,P,C,g) => floor(C,30,280) + `<rect x="62" y="150" width="40" height="76" rx="4" fill="${C.eq}"/>`, hand:(J,P,C,g) => g.circ([J.hip[0]+2, J.hip[1]-16], 9, C.eq) },
    'Seated Calf Raise': { root:'toe', toe:[208,212], hl:['calves'],
      a:{ foot:162, shin:-90, thigh:180, torso:-92, ua:70, fa:-20 }, b:{ foot:215, shin:-90, thigh:180, torso:-92, ua:70, fa:-20 },
      props:(J,P,C,g) => floor(C) + `<rect x="186" y="216" width="50" height="10" fill="${C.eq}"/>` + seat(C,120,175,J.hip[1]+12) + g.ln([J.knee[0]-22,J.knee[1]-12],[J.knee[0]+6,J.knee[1]-12],8,C.eq) },
    'Hanging Knee Raise': { hip:[150,140], hl:['abs'],
      a:{ torso:-90, ua:-90, fa:-90, thigh:90, shinD:90 }, b:{ torso:-84, ua:-94, fa:-90, thigh:-22, shinD:76 },
      props:(J,P,C,g) => g.ln([90,4],[230,4],5,C.eq) + g.ln([90,4],[90,240],4,C.eq) + g.ln([230,4],[230,240],4,C.eq) },
    // Batch 2 (#653): same joints, props and highlight bands as above.
    'Dumbbell Split Squat': { kb:-1, eb:1, hl:['quads','glutes'],
      a:{ hip:[140,126], ankle:[182,213], torso:-90, ua:93, fa:90, rx:92 }, b:{ hip:[136,166], ankle:[182,213], torso:-90, ua:93, fa:90, rx:92 },
      rear:splitRear,
      props:(J,P,C,g) => { const [, rk, ra] = splitRear(J,P);
        return floor(C) + g.ln(J.hip,rk,13,C.body) + g.ln(rk,ra,9,C.body) + g.ln(ra,[ra[0] + 9,222],7,C.body); }, hand:(J,P,C,g) => db(J.wr,C,g,true) },
    'Dumbbell Bench Press': { hip:[190,165], eb:1, kb:-1, hl:['chest','triceps'],
      a:{ ankle:[232,222], torso:180, wrist:[126,150], uaS:.55 }, b:{ ankle:[232,222], torso:180, wrist:[124,98], uaS:1 },
      props:(J,P,C,g) => floor(C,40,290) + g.ln([92,180],[210,180],9,C.eq) + g.ln([150,180],[150,226],4,C.eq), hand:(J,P,C,g) => g.circ(J.wr, 8, C.eq) },
    'Push-ups': { root:'toe', toe:[58,224], eb:1, hl:['chest','triceps'],
      a:{ foot:-60, shin:-19, thigh:-19, torso:-19, wrist:[226,224] }, b:{ foot:-60, shin:-8, thigh:-8, torso:-8, wrist:[226,224] },
      props:(J,P,C) => floor(C,30,280) },
    'Barbell Back Squat': { kb:-1, eb:-1, hl:['quads','glutes'],
      a:{ hip:[146,114], ankle:[150,212], torso:-90, wristR:[-12,-8] }, b:{ hip:[112,168], ankle:[150,212], torso:-62, wristR:[-12,-8] },
      props:(J,P,C,g) => floor(C) + g.circ([J.sh[0] - 6, J.sh[1] - 5], 14, 'none', ` stroke="${C.eq}" stroke-width="4"`) + g.circ([J.sh[0] - 6, J.sh[1] - 5], 4, C.eq), hand:(J,P,C,g) => g.circ(J.wr, 5, C.eq) },
    'Bodyweight Squat': { kb:-1, hl:['quads','glutes'],
      a:{ hip:[146,114], ankle:[150,212], torso:-90, ua:0, fa:0 }, b:{ hip:[118,168], ankle:[150,212], torso:-66, ua:0, fa:0 },
      props:(J,P,C) => floor(C) },
    'Deadlift': { kb:-1, eb:1, hl:['glutes','hams','back'],
      a:{ hip:[106,160], ankle:[150,212], torso:-14, wrist:[162,211] }, b:{ hip:[146,114], ankle:[150,212], torso:-88, wrist:[150,110] },
      props:(J,P,C,g) => floor(C,60,260) + g.circ(J.wr, 14, 'none', ` stroke="${C.eq}" stroke-width="4"`) + g.circ(J.wr, 4, C.eq), hand:(J,P,C,g) => g.circ(J.wr, 5, C.eq) },
    'Barbell Row': { hip:[126,124], kb:-1, eb:1, hl:['back','biceps'],
      a:{ ankle:[150,212], torso:-22, wrist:[190,164] }, b:{ ankle:[150,212], torso:-22, wrist:[162,124] },
      props:(J,P,C,g) => floor(C,60,260) + g.circ(J.wr, 12, 'none', ` stroke="${C.eq}" stroke-width="4"`) + g.circ(J.wr, 4, C.eq), hand:(J,P,C,g) => g.circ(J.wr, 5, C.eq) },
    'Bodyweight Pull-up': { hl:['back','biceps'], eb:1,
      a:{ hip:[150,170], torso:-95, wrist:[156,34], thigh:80, shinD:200, footA:180 }, b:{ hip:[150,118], torso:-95, wrist:[156,34], thigh:80, shinD:200, footA:180 },
      props:(J,P,C,g) => g.ln([100,30],[240,30],5,C.eq) + g.ln([100,30],[100,240],4,C.eq) + g.ln([240,30],[240,240],4,C.eq) },
    'Glute Bridge': { kb:-1, hl:['glutes','hams'],
      a:{ hip:[150,200], ankle:[205,214], torso:172, neck:0, ua:0, fa:0 }, b:{ hip:[150,166], ankle:[205,214], torso:145, neck:35, ua:12, fa:12 },
      props:(J,P,C) => floor(C,30,280) },
    'Crunch': { kb:-1, hl:['abs'],
      a:{ hip:[150,206], ankle:[205,214], torso:-182, neck:0, uaR:-160, faR:-60 }, b:{ hip:[150,206], ankle:[205,214], torso:-146, neck:8, uaR:-160, faR:-60 },
      props:(J,P,C) => floor(C,30,280) },
    'Dumbbell Romanian Deadlift': { kb:-1, eb:1, hl:['hams','glutes'],
      a:{ hip:[146,116], ankle:[150,212], torso:-90, wrist:[150,112] }, b:{ hip:[118,124], ankle:[150,212], torso:-20, wrist:[176,164] },
      props:(J,P,C) => floor(C), hand:(J,P,C,g) => db(J.wr,C,g,false) },
    'Standing Barbell Press': { front:true, eb:1, hl:['shoulders','triceps'],
      a:{ wrist:[204,66] }, b:{ wrist:[180,16] },
      props:(J,P,C,g) => floor(C,90,230) + (P.wrist ? g.ln([96,P.wrist[1]],[224,P.wrist[1]],4,C.eq) + g.circ([96,P.wrist[1]],8,C.eq) + g.circ([224,P.wrist[1]],8,C.eq) : ''), hand:(A,P,C,g) => g.circ(A.wr, 5, C.eq) },
    // Batch 3 (#653): same joints, props and highlight bands as above.
    'Barbell Romanian Deadlift': { kb:-1, eb:1, hl:['hams','glutes'],
      a:{ hip:[146,116], ankle:[150,212], torso:-90, wrist:[148,112] }, b:{ hip:[100,130], ankle:[150,212], torso:-30, wrist:[160,162] },
      props:(J,P,C,g) => floor(C) + g.circ(J.wr, 12, 'none', ` stroke="${C.eq}" stroke-width="4"`) + g.circ(J.wr, 4, C.eq), hand:(J,P,C,g) => g.circ(J.wr, 5, C.eq) },
    'Split Squat': { kb:-1, eb:1, hl:['quads','glutes'],
      a:{ hip:[140,126], ankle:[182,213], torso:-90, ua:93, fa:90, rx:92 }, b:{ hip:[136,166], ankle:[182,213], torso:-90, ua:93, fa:90, rx:92 },
      rear:splitRear,
      props:(J,P,C,g) => { const [, rk, ra] = splitRear(J,P);
        return floor(C) + g.ln(J.hip,rk,13,C.body) + g.ln(rk,ra,9,C.body) + g.ln(ra,[ra[0] + 9,222],7,C.body); } },
    'Bulgarian Split Squat': { kb:-1, eb:1, hl:['quads','glutes'],
      a:{ hip:[152,124], ankle:[190,213], torso:-90, ua:93, fa:90 }, b:{ hip:[140,166], ankle:[190,213], torso:-90, ua:93, fa:90 },
      rear:bulgarianRear,
      props:(J,P,C,g) => { const [, rk, rf] = bulgarianRear(J);
        return floor(C) + g.ln([46,182],[100,182],9,C.eq) + g.ln([54,182],[54,226],4,C.eq) + g.ln([92,182],[92,226],4,C.eq) + g.ln(J.hip,rk,13,C.body) + g.ln(rk,rf,9,C.body) + g.ln(rf,[66,172],7,C.body); } },
    'Preacher Curl': { hip:[120,152], kb:-1, hl:['biceps'],
      a:{ ankle:[172,214], torso:-75, ua:62, fa:68 }, b:{ ankle:[172,214], torso:-75, ua:62, fa:-62 },
      props:(J,P,C,g) => { const p0 = g.pt(g.pt(J.sh,152,12),62,4), p1 = g.pt(g.pt(J.sh,152,12),62,56);
        return floor(C) + seat(C,92,150,164) + g.ln(p0,p1,9,C.eq) + g.ln(p1,[p1[0],226],4,C.eq); }, hand:(J,P,C,g) => grip(J.wr,C,g) },
    'Straight-Arm Pulldown': { root:'ankle', ankle:[140,212], hl:['back'],
      a:{ shin:-90, thigh:-92, torso:-70, ua:-30, fa:-30 }, b:{ shin:-90, thigh:-92, torso:-70, ua:85, fa:85 },
      props:(J,P,C,g) => floor(C) + g.ln([270,8],[270,226],4,C.eq) + cable(J.wr,[258,12],C,g), hand:(J,P,C,g) => grip(J.wr,C,g) },
    'Lying Leg Raise': { hip:[190,211], hl:['abs'],
      a:{ torso:180, thigh:-10, shinD:-10, footA:-85, ua:6, fa:6 }, b:{ torso:180, thigh:-88, shinD:-85, footA:-180, ua:6, fa:6 },
      props:(J,P,C) => floor(C,30,300) },
    'Bench Dips': { kb:-1, eb:1, hl:['triceps','chest'],
      a:{ hip:[124,170], ankle:[208,214], torso:-92, wrist:[102,164] }, b:{ hip:[126,194], ankle:[208,214], torso:-92, wrist:[102,164] },
      props:(J,P,C,g) => floor(C,30,280) + g.ln([40,172],[106,172],9,C.eq) + g.ln([48,172],[48,226],4,C.eq) + g.ln([98,172],[98,226],4,C.eq), hand:(J,P,C,g) => g.circ(J.wr, 4, C.eq) },
    'Incline Push-ups': { root:'toe', toe:[58,224], eb:1, hl:['chest','triceps'],
      a:{ foot:-60, shin:-33.5, thigh:-33.5, torso:-33.5, wrist:[222,183] }, b:{ foot:-60, shin:-24, thigh:-24, torso:-24, wrist:[222,183] },
      props:(J,P,C,g) => floor(C,30,280) + g.ln([205,192],[262,192],9,C.eq) + g.ln([214,192],[214,226],4,C.eq) + g.ln([254,192],[254,226],4,C.eq) },
    'Pike Push-ups': { root:'toe', toe:[112,224], eb:1, hl:['shoulders','triceps'],
      a:{ foot:-60, shin:-71, thigh:-71, torso:34.5, wrist:[196,224] }, b:{ foot:-60, shin:-68, thigh:-68, torso:58, wrist:[196,224] },
      props:(J,P,C) => floor(C,30,280) },
    'Dumbbell Floor Press': { hip:[190,212], eb:1, kb:-1, hl:['chest','triceps'],
      a:{ ankle:[250,214], torso:180, wrist:[128,188], uaS:.55 }, b:{ ankle:[250,214], torso:180, wrist:[124,146], uaS:1 },
      props:(J,P,C) => floor(C,40,290), hand:(J,P,C,g) => g.circ(J.wr, 8, C.eq) },
    'Cable Pull-through': { kb:-1, eb:1, hl:['glutes','hams'],
      a:{ hip:[116,124], ankle:[150,212], torso:-35, wrist:[150,146] }, b:{ hip:[150,116], ankle:[150,212], torso:-92, wrist:[160,112] },
      props:(J,P,C,g) => floor(C,20,280) + g.ln([34,100],[34,226],4,C.eq) + cable(J.wr,[38,212],C,g), hand:(J,P,C,g) => grip(J.wr,C,g) },
    'Decline Push-ups': { root:'toe', toe:[58,140], eb:1, hl:['chest','triceps'],
      a:{ foot:-60, shin:10.4, thigh:10.4, torso:10.4, wrist:[236,224] }, b:{ foot:-60, shin:18, thigh:18, torso:18, wrist:[236,224] },
      props:(J,P,C,g) => floor(C,30,280) + g.ln([36,148],[88,148],9,C.eq) + g.ln([44,148],[44,226],4,C.eq) + g.ln([80,148],[80,226],4,C.eq) },
    // Batch 4 (#653): isometrics hold one static pose (the same pose for start and end), then the last exercises.
    'Cable Crossover': { front:true, hl:['chest'],
      a:{ ua:20, fa:8 }, b:{ ua:98, fa:112 },
      props:(J,P,C,g) => floor(C,20,300) + g.ln([272,6],[272,226],4,C.eq) + g.ln([48,6],[48,226],4,C.eq),
      hand:(A,P,C,g) => cable(A.wr,[A.m > 0 ? 264 : 56, 12],C,g) + grip(A.wr,C,g) },
    'Close-Grip Bench Press': { hip:[190,165], eb:1, kb:-1, hl:['triceps','chest'],
      a:{ ankle:[232,222], torso:180, wrist:[150,140] }, b:{ ankle:[232,222], torso:180, wrist:[128,98] },
      props:(J,P,C,g) => floor(C,40,290) + g.ln([92,180],[210,180],9,C.eq) + g.ln([150,180],[150,226],4,C.eq) + g.ln([108,226],[108,92],4,C.eq) + g.ln([108,92],[118,92],4,C.eq),
      hand:(J,P,C,g) => g.circ(J.wr, 6, C.eq) },
    'Assisted Dips': { eb:1, hl:['triceps','chest'],
      a:{ hip:[124,121], torso:-82, wrist:[130,119], thigh:90, shinD:182, footA:180 }, b:{ hip:[144,155], torso:-72, wrist:[130,119], thigh:90, shinD:182, footA:180 },
      props:(J,P,C,g) => g.ln([J.wr[0]-16,J.wr[1]+6],[J.wr[0]+16,J.wr[1]+6],6,C.eq) + g.ln([J.wr[0]-8,J.wr[1]+6],[J.wr[0]-8,226],4,C.eq)
        + g.ln([40,J.knee[1]+11],[J.knee[0]-34,J.knee[1]+11],3,C.eq) + g.ln([J.knee[0]-34,J.knee[1]+11],[J.knee[0]+10,J.knee[1]+11],8,C.eq) + floor(C,20,300), hand:(J,P,C,g) => g.circ(J.wr, 4, C.eq) },
    'Weighted Pull-up': { hl:['back','biceps'], eb:1,
      a:{ hip:[150,170], torso:-95, wrist:[156,34], thigh:80, shinD:200, footA:180 }, b:{ hip:[150,118], torso:-95, wrist:[156,34], thigh:80, shinD:200, footA:180 },
      props:(J,P,C,g) => g.ln([100,30],[240,30],5,C.eq) + g.ln([100,30],[100,240],4,C.eq) + g.ln([240,30],[240,240],4,C.eq),
      hand:(J,P,C,g) => g.ln([J.hip[0]+4,J.hip[1]+6],[J.hip[0]+20,J.hip[1]+26],2,C.eq) + g.circ([J.hip[0]+22,J.hip[1]+36],10,C.eq) + g.circ([J.hip[0]+22,J.hip[1]+36],3,C.bg) },
    'Walking Lunge': { kb:-1, eb:1, hl:['quads','glutes'],
      a:{ hip:[94,114.2], ankle:[92,212], torso:-90, ua:93, fa:90, heel:180 }, b:{ hip:[136,166], ankle:[182,213], torso:-90, ua:93, fa:90, heel:225 },
      rear:lungeRear,
      props:(J,P,C,g) => { const [, rk, ra, rt] = lungeRear(J,P);
        return floor(C) + g.ln(J.hip,rk,13,C.body) + g.ln(rk,ra,9,C.body) + g.ln(ra,rt,7,C.body); }, hand:(J,P,C,g) => db(J.wr,C,g,true) },
    'Overhead Dumbbell Extension': { hip:[130,165], hl:['triceps'],
      a:{ torso:-90, neck:22, thigh:0, shinD:95, ua:-100, fa:-96 }, b:{ torso:-90, neck:22, thigh:0, shinD:95, ua:-100, fa:125 },
      props:(J,P,C,g) => floor(C) + seat(C,98,170,176) + backPad(J,C,g), hand:(J,P,C,g) => db(J.wr,C,g,true) },
    'Single-Leg Glute Bridge': { kb:-1, hl:['glutes','hams'],
      a:{ hip:[150,200], ankle:[205,214], torso:172, neck:0, ua:0, fa:0 }, b:{ hip:[150,166], ankle:[205,214], torso:145, neck:35, ua:12, fa:12 },
      rear:bridgeFree,
      props:(J,P,C,g) => floor(C,30,280) + freeLegs(bridgeFree,J,C,g,-110) },
    'Single-Leg Calf Raise': { root:'toe', toe:[190,214], eb:1, hl:['calves'],
      a:{ foot:170, shin:-90, thigh:-90, torso:-90, wrist:[240,60] }, b:{ foot:200, shin:-90, thigh:-90, torso:-90, wrist:[240,60] },
      rear:calfFree,
      props:(J,P,C,g) => floor(C) + `<rect x="184" y="218" width="50" height="8" fill="${C.eq}"/>` + g.ln([246,12],[246,226],4,C.eq) + freeLegs(calfFree,J,C,g,130), hand:(J,P,C,g) => g.circ(J.wr, 5, C.eq) },
    'Backpack Row': { hip:[126,124], kb:-1, eb:1, hl:['back','biceps'],
      a:{ ankle:[150,212], torso:-22, wrist:[190,165] }, b:{ ankle:[150,212], torso:-22, wrist:[162,124] },
      props:(J,P,C) => floor(C,60,260),
      hand:(J,P,C,g) => g.ln([J.wr[0]-5,J.wr[1]+3],[J.wr[0]+5,J.wr[1]+3],3,C.eq) + `<rect x="${(J.wr[0]-10).toFixed(1)}" y="${(J.wr[1]+3).toFixed(1)}" width="20" height="26" rx="6" fill="${C.eq}"/>` },
    // Batch 5 (own drawings, side view). faS scales the forearm (like uaS scales the upper arm) so an arm that opens out of the side view foreshortens as a whole and the elbow can stay soft. Dumbbell Fly uses it. Prone Y-T-W Raise and Archer Push-ups stay without a drawing: they need a front or top view (#1120).
    'Dumbbell Fly': { hip:[190,165], eb:1, kb:-1, hl:['chest'],
      a:{ ankle:[232,222], torso:180, ua:95, fa:120, uaS:.55, faS:.55 }, b:{ ankle:[232,222], torso:180, ua:-92, fa:-82, uaS:1, faS:1 },
      props:(J,P,C,g) => floor(C,40,290) + g.ln([92,180],[210,180],9,C.eq) + g.ln([150,180],[150,226],4,C.eq), hand:(J,P,C,g) => g.circ(J.wr, 8, C.eq) },
    'Dead Bug': { hip:[190,211], hl:['abs'],
      a:{ torso:180, thigh:-90, shinD:0, footA:-90, ua:-90, fa:-90 }, b:{ torso:180, thigh:-12, shinD:-8, footA:-85, ua:192, fa:192 },
      props:(J,P,C) => floor(C,30,300) },
    'Single-Leg Balance (seconds)': { root:'toe', toe:[190,214], hl:['abs'],
      a:BALANCE, b:BALANCE, rear:calfFree,
      props:(J,P,C,g) => floor(C) + freeLegs(calfFree,J,C,g,130) },
    'Plank (seconds)': { root:'toe', toe:[50,224], hl:['abs'],
      a:PLANK, b:PLANK, props:(J,P,C) => floor(C,20,300) },
    'Wall Sit (seconds)': { hip:[140,164], hl:['quads'],
      a:WALL_SIT, b:WALL_SIT, props:(J,P,C,g) => floor(C,30,280) + g.ln([J.hip[0]-14,16],[J.hip[0]-14,226],5,C.eq) },
  };

  function frame(name, k, C){
    const E = D[name]; if(!E) return '';
    const P = mix(E.a, E.b, k);
    if(P.left && E.a.left) P.left = mix(E.a.left, E.b.left || E.a.left, k);
    return E.front ? drawFront(E, P, C) : drawSide(E, P, C);
  }
  // Joint positions of the side-view poses (null for front-view ones), for the segment-length test.
  function joints(name, k){
    const E = D[name]; if(!E || E.front) return null;
    const P = mix(E.a, E.b, k), J = sideJoints(E, P);
    return { J, uaS: P.uaS || 1, faS: P.faS || 1, rear: E.rear ? E.rear(J, P) : null };
  }
  return { frame, joints, has: n => !!D[n], names: Object.keys(D) };
})();
