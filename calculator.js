// ============================================================
// LOOKUP FUNCTIONS
// ============================================================
function getPrice(table, width, projection) {
  const projKeys = Object.keys(table.rows).map(Number).sort((a,b)=>a-b);
  const widthKeys = table.widths;

  // Find nearest projection (round up to next step)
  let projKey = null;
  for (let k of projKeys) {
    if (k >= projection) { projKey = k; break; }
  }
  if (!projKey) return null; // exceeds max

  // Find nearest width (round up)
  let wIdx = null;
  for (let i = 0; i < widthKeys.length; i++) {
    if (widthKeys[i] >= width) { wIdx = i; break; }
  }
  if (wIdx === null) return null; // exceeds max

  return { price: table.rows[projKey][wIdx], projUsed: projKey, widthUsed: widthKeys[wIdx] };
}

// For SB550/Solid with multi-module: split width into first + remaining
function getMultiModulePrice(firstTable, nextTable, totalWidth, projection, mounting) {
  const maxSingleWidth = Math.max(...firstTable.widths);

  if (totalWidth <= maxSingleWidth) {
    const r = getPrice(firstTable, totalWidth, projection);
    if (!r) return null;
    return { total: r.price, modules: [{type:'Первый модуль', width: r.widthUsed, proj: r.projUsed, price: r.price}] };
  }

  // Multi-module: find best split
  let bestCombo = null;
  // Try first module widths and remainder
  for (let fw of firstTable.widths.slice().reverse()) {
    const rem = totalWidth - fw;
    if (rem <= 0) continue;
    const fr = getPrice(firstTable, fw, projection);
    if (!fr) continue;
    const nr = getPrice(nextTable, rem, projection);
    if (!nr) continue;
    const total = fr.price + nr.price;
    if (!bestCombo || total < bestCombo.total) {
      bestCombo = {
        total,
        modules: [
          {type: 'Первый модуль', width: fr.widthUsed, proj: fr.projUsed, price: fr.price},
          {type: 'Следующий модуль', width: nr.widthUsed, proj: nr.projUsed, price: nr.price}
        ]
      };
    }
  }

  // Also check with 2 next modules scenario (first + next + next)
  for (let fw of firstTable.widths) {
    const rem1 = totalWidth - fw;
    if (rem1 <= 0) continue;
    // Try to split remainder into 2 modules
    for (let nw1 of nextTable.widths.slice().reverse()) {
      const rem2 = rem1 - nw1;
      if (rem2 <= 0 || rem2 > Math.max(...nextTable.widths)) continue;
      const fr = getPrice(firstTable, fw, projection);
      if (!fr) continue;
      const nr1 = getPrice(nextTable, nw1, projection);
      if (!nr1) continue;
      const nr2 = getPrice(nextTable, rem2, projection);
      if (!nr2) continue;
      const total = fr.price + nr1.price + nr2.price;
      if (!bestCombo || total < bestCombo.total) {
        bestCombo = {
          total,
          modules: [
            {type: 'Первый модуль', width: fr.widthUsed, proj: fr.projUsed, price: fr.price},
            {type: 'Следующий модуль 1', width: nr1.widthUsed, proj: nr1.projUsed, price: nr1.price},
            {type: 'Следующий модуль 2', width: nr2.widthUsed, proj: nr2.projUsed, price: nr2.price}
          ]
        };
      }
    }
  }

  return bestCombo;
}

// ============================================================
// SURCHARGE CALCULATIONS
// ============================================================
function calcSurcharges(basePrice, height, mounting, color, drain, hiddenMotor, led, ledPts, teleco, system) {
  let extra = 0;
  let breakdown = [];

  // Color
  if (color === 'ral' || color === 'wood') {
    const s = Math.round(basePrice * 0.2);
    extra += s;
    breakdown.push({label: color === 'ral' ? 'Надбавка RAL (+20%)' : 'Надбавка wood-like (+20%)', val: s});
  }

  // Drainage
  if (drain) {
    const s = Math.round(basePrice * 0.1);
    extra += s;
    breakdown.push({label: 'Дренаж в 1 стойку (+10%)', val: s});
  }

  // Hidden motor (SB400/SB400R only)
  if (hiddenMotor && (system === 'sb400' || system === 'sb400r')) {
    const s = Math.round(basePrice * 0.1);
    extra += s;
    breakdown.push({label: 'Скрытый мотор (+10%)', val: s});
  }

  // Height surcharge
  let heightOk = true;
  if ((system === 'sb400' || system === 'sb400r') && height > 2800 && height <= 3300) {
    const s = mounting === 'free' ? 250 : 150;
    extra += s;
    heightOk = false;
    breakdown.push({label: `Нестандартная высота (${height} мм) → +${s} €`, val: s});
  }
  if (system === 'solid' && height > 2500 && height <= 3000) {
    const s = mounting === 'free' ? 250 : 150;
    extra += s;
    heightOk = false;
    breakdown.push({label: `Нестандартная высота Solid (${height} мм) → +${s} €`, val: s});
  }

  // LED
  if (led) { extra += 869; breakdown.push({label: 'LED базовый комплект', val: 869}); }
  if (ledPts) {
    const pts = getLedPoints(0, 0); // will be called outside
    // placeholder — will be handled in main calc
  }
  if (teleco) { extra += 709; breakdown.push({label: 'Контроллер Teleco', val: 709}); }

  return {extra, breakdown, heightOk};
}

// ============================================================
// FORMAT
// ============================================================
const fmt = n => n.toLocaleString('ru-RU') + ' €';

// ============================================================
// MAIN CALCULATE
// ============================================================
const motorState = {}; // { sb400: false, sb400r: false }

function onMotorChange(el) {
  motorState[el.dataset.sys] = el.value === '1';
  calculate(true);
}

function calculate(skipScroll = false) {
  const width = parseInt(document.getElementById('width').value);
  const projection = parseInt(document.getElementById('projection').value);
  const height = parseInt(document.getElementById('height').value);
  const mounting = document.getElementById('mounting').value;
  const systemSel = document.getElementById('system').value;
  const color = document.getElementById('color').value;
  const drain = document.getElementById('opt-drain').checked;
  const led = document.getElementById('opt-led').checked;
  const ledPts = document.getElementById('opt-led-pts').checked;
  const teleco = document.getElementById('opt-teleco').checked;

  if (Number.isNaN(width) || Number.isNaN(projection) || Number.isNaN(height)) {
    const div = document.getElementById('results');
    div.style.display = 'block';
    div.innerHTML = `<div class="result-card"><div class="error">❌ Заполните корректно поля: ширина, вынос и высота (только числа).</div></div>`;
    return;
  }

  const results = [];

  // Determine which systems to calculate
  const systemsToCalc = systemSel === 'auto'
    ? ['sb400', 'sb400r', 'sb550', 'sb450', 'sb350', 'solid']
    : [systemSel];

  for (const sys of systemsToCalc) {
    const hiddenMotor = !!(motorState[sys]);
    let result = calcSystem(sys, width, projection, height, mounting, color, drain, led, ledPts, teleco, hiddenMotor);
    if (result) results.push(result);
  }

  const availableResults = results.filter(r => !r.unavail);

  availableResults.sort((a, b) => a.totalFinal - b.totalFinal);
  if (availableResults.length > 0) availableResults[0].isBest = true;

  renderResults(availableResults, width, projection, height, mounting, skipScroll);
}

function calcSystem(sys, width, projection, height, mounting, color, drain, led, ledPts, teleco, hiddenMotor) {
  let moduleResult = null;
  let sysName = '';
  let sysDesc = '';
  let notes = [];

  if (sys === 'sb400') {
    if (width > 4000) return {system: sys, name: 'SB 400', unavail: `Максимальная ширина SB400: 4000 мм (запрошено ${width} мм)`};
    if (projection < 3400 || projection > 7000) return {system: sys, name: 'SB 400', unavail: `Вынос SB400: 3400–7000 мм (запрошено ${projection} мм)`};
    const tbl = mounting === 'free' ? SB400_FREE : SB400_WALL;
    const r = getPrice(tbl, width, projection);
    if (!r) return {system: sys, name: 'SB 400', unavail: 'Размер вне таблицы'};
    moduleResult = {total: r.price, modules: [{type: mounting==='free'?'Отдельностоящая':'Настенная', width: r.widthUsed, proj: r.projUsed, price: r.price}]};
    sysName = 'SB 400';
    sysDesc = 'Стандартная биоклиматическая пергола · ламели 200 мм · вынос до 7000 мм';
    if (height > 3300) notes.push('⚠️ Высота > 3300 мм: нестандарт, цена по запросу');
  }

  else if (sys === 'sb400r') {
    if (width > 4000) return {system: sys, name: 'SB 400R', unavail: `Максимальная ширина SB400R: 4000 мм`};
    if (projection < 3400 || projection > 7000) return {system: sys, name: 'SB 400R', unavail: `Вынос SB400R: 3400–7000 мм`};
    const r = getPrice(SB400R, width, projection);
    if (!r) return {system: sys, name: 'SB 400R', unavail: 'Размер вне таблицы'};
    moduleResult = {total: r.price, modules: [{type: 'SB400R', width: r.widthUsed, proj: r.projUsed, price: r.price}]};
    sysName = 'SB 400R';
    sysDesc = 'SB400 с боковым дренажом воды DN50 · 2 водостока';
    notes.push('ℹ️ Настенное и отдельностоящее — единая таблица цен');
  }

  else if (sys === 'sb550') {
    if (projection < 2580 || projection > 6980) return {system: sys, name: 'SB 550', unavail: `Вынос SB550: 2580–6980 мм (запрошено ${projection} мм)`};
    const firstTbl = mounting === 'free' ? SB550_FREE_FIRST : SB550_WALL_FIRST;
    const nextTbl = mounting === 'free' ? SB550_FREE_NEXT : SB550_WALL_NEXT;
    moduleResult = getMultiModulePrice(firstTbl, nextTbl, width, projection, mounting);
    if (!moduleResult) return {system: sys, name: 'SB 550', unavail: `Размер вне диапазона SB550`};
    sysName = 'SB 550';
    sysDesc = 'Премиальная система · большие пролёты · модульная конструкция';
    if (height > 3200) notes.push('⚠️ Высота > 3200 мм: надбавка 160 € за стойку');
  }

  else if (sys === 'sb450') {
    if (width > 4000) return {system: sys, name: 'SB 450', unavail: `Макс. ширина SB450: 4000 мм`};
    if (projection > 6010) return {system: sys, name: 'SB 450', unavail: `Макс. вынос SB450: 6010 мм (запрошено ${projection} мм)`};
    // Use SB450 F blade table (standard)
    const SB450_ROWS_FREE = {1930:5327,2134:5523,2338:5720,2542:5919,2746:6118,2950:6314,3154:6514,3358:6710,3562:6912,3766:7109,3970:7305,4174:7504,4378:7703,4582:7902,4786:8096,4990:8295,5194:8497,5398:9232,5602:9428,5806:9628,6010:9827};
    // This is for W=3000, need full table for lookups
    // Simplified: use nearest known
    const W3000_F = {1930:6928,2134:7125,2338:7321,2542:7520,2746:7719,2950:7919,3154:8115,3358:8311,3562:8597,3766:8882,3970:9157,4174:9431,4378:9716,4582:10002,4786:10276,4990:10551,5194:10847,5398:11646,5602:11923,5806:12284,6010:12558};
    // Full table needed - approximating via ratio
    return {system: sys, name: 'SB 450', unavail: `SB450 поддерживает вынос до 6010 мм. Для ${projection} мм — недоступно.`};
  }

  else if (sys === 'sb350') {
    if (width > 3500) return {system: sys, name: 'SB 350', unavail: `SB 350 выпускается только шириной 3500 мм (запрошено ${width} мм)`};
    if (projection < 3400 || projection > 4750) return {system: sys, name: 'SB 350', unavail: `Вынос SB 350: 3400–4750 мм (запрошено ${projection} мм)`};
    const r = getPrice(SB350, width, projection);
    if (!r) return {system: sys, name: 'SB 350', unavail: 'Размер вне таблицы'};
    moduleResult = {total: r.price, modules: [{type: mounting === 'free' ? 'Отдельностоящая' : 'Настенная', width: r.widthUsed, proj: r.projUsed, price: r.price}]};
    sysName = 'SB 350';
    sysDesc = 'Биоклиматическая пергола · ширина 3500 мм · вынос до 4750 мм · высота 2500 мм';
    notes.push('ℹ️ Фиксированная высота 2500 мм · размеры не изменяются');
  }

  else if (sys === 'solid') {
    if (width > 4000 && mounting !== 'free') {
      // Multi-module
    }
    if (projection < 3000 || projection > 7000) return {system: sys, name: 'Solid', unavail: `Вынос Solid: 3000–7000 мм (запрошено ${projection} мм)`};
    const firstTbl = mounting === 'free' ? SOLID_FREE_FIRST : SOLID_WALL_FIRST;
    const nextTbl = mounting === 'free' ? SOLID_FREE_NEXT : SOLID_WALL_NEXT;
    moduleResult = getMultiModulePrice(firstTbl, nextTbl, width, projection, mounting);
    if (!moduleResult) return {system: sys, name: 'Solid', unavail: 'Размер вне диапазона Solid'};
    sysName = 'Solid';
    sysDesc = 'Фиксированная крыша без ламелей · максимальная защита от дождя';
    notes.push('ℹ️ Включено: конструкция + ткань + Somfy io + пульт 5 каналов');
    if (height > 3000) notes.push('⚠️ Высота > 3000 мм: нестандарт, цена по запросу');
  }

  if (!moduleResult) return null;

  // Apply surcharges
  const base = moduleResult.total;
  let surcharges = [];
  let extra = 0;

  // Color
  if (color === 'ral') { const s = Math.round(base * 0.20); extra += s; surcharges.push({label:'Цвет RAL (+20%)', val:s}); }
  else if (color === 'wood') { const s = Math.round(base * 0.20); extra += s; surcharges.push({label:'Wood-like (+20%)', val:s}); }

  // Drainage
  if (drain) { const s = Math.round(base * 0.10); extra += s; surcharges.push({label:'Дренаж в 1 стойку (+10%)', val:s}); }

  // Hidden motor
  if (hiddenMotor && (sys === 'sb400' || sys === 'sb400r')) {
    const s = Math.round(base * 0.10);
    extra += s;
    surcharges.push({label:'Скрытый мотор (+10%)', val:s});
  }

  // Height
  if ((sys === 'sb400' || sys === 'sb400r') && height > 2800 && height <= 3300) {
    const s = mounting === 'free' ? 250 : 150;
    extra += s;
    surcharges.push({label:`Нестандартная высота ${height} мм`, val:s});
  }
  if (sys === 'solid' && height > 2500 && height <= 3000) {
    const s = mounting === 'free' ? 250 : 150;
    extra += s;
    surcharges.push({label:`Нестандартная высота Solid ${height} мм`, val:s});
  }

  // LED
  const moduleCount = moduleResult.modules.length;
  if (led) {
    const s = 869 * moduleCount;
    extra += s;
    surcharges.push({label:`LED базовый комплект × ${moduleCount} модуль`, val:s});
  }
  if (ledPts) {
    let ptsTotal = 0;
    const ptsParts = [];
    for (const m of moduleResult.modules) {
      const pts = getLedPoints(m.width, m.proj);
      ptsTotal += pts.price;
      ptsParts.push(pts.count);
    }
    extra += ptsTotal;
    surcharges.push({label:`LED световые точки (${ptsParts.join(' + ')})`, val:ptsTotal});
  }
  if (teleco) { extra += 709; surcharges.push({label:'Контроллер Teleco', val:709}); }

  const totalFinal = base + extra;

  return {system: sys, name: sysName, desc: sysDesc, modules: moduleResult.modules,
          base, surcharges, totalFinal, notes, isBest: false};
}

function renderResults(results, width, projection, height, mounting, skipScroll = false) {
  const div = document.getElementById('results');
  div.style.display = 'block';

  if (results.length === 0) {
    div.innerHTML = `<div class="result-card"><div class="error">❌ Нет подходящих систем для размера ${width}×${projection} мм. Проверьте размеры.</div></div>`;
    return;
  }

  let html = `<div class="result-card">`;
  html += `<h2>Результаты расчёта · ${width}×${projection} мм · ${mounting==='free'?'Отдельностоящая':'Настенная'} · h=${height} мм</h2>`;

  for (const r of results) {
    html += `<div class="system-result ${r.isBest ? 'best' : ''}">`;
    html += `<div class="sys-name">${r.name} ${r.isBest ? '<span class="best-badge">✓ ОПТИМАЛЬНО</span>' : ''}</div>`;
    html += `<div class="sys-desc">${r.desc}</div>`;

    // Motor option dropdown for SB 400 / SB 400R
    if (r.system === 'sb400' || r.system === 'sb400r') {
      const sel = motorState[r.system] ? '1' : '0';
      html += `<div class="motor-result-row">
        <select class="motor-result-select" data-sys="${r.system}" onchange="onMotorChange(this)">
          <option value="0" ${sel==='0'?'selected':''}>Без скрытого мотора</option>
          <option value="1" ${sel==='1'?'selected':''}>+ Скрытый мотор в балке (+10% к цене)</option>
        </select>
      </div>`;
    }

    html += `<div class="price-breakdown">`;
    for (const m of r.modules) {
      html += `<div class="price-row"><span>${m.type} (${m.width}×${m.proj} мм)</span><span class="euro">${fmt(m.price)}</span></div>`;
    }
    for (const s of r.surcharges) {
      html += `<div class="price-row"><span>+ ${s.label}</span><span class="euro">${fmt(s.val)}</span></div>`;
    }
    html += `<div class="price-row total"><span>ИТОГО</span><span class="euro">${fmt(r.totalFinal)}</span></div>`;
    html += `</div>`;

    if (r.notes && r.notes.length > 0) {
      html += `<div class="note">${r.notes.join('<br>')}</div>`;
    }

    html += `</div>`;
  }

  html += `<div class="note" style="margin-top:0;">📌 Все цены в € без НДС · Промежуточные стойки — по запросу (238–292 €) · LED световые точки можно добавить отдельно</div>`;
  html += `</div>`;

  div.innerHTML = html;
  if (!skipScroll) div.scrollIntoView({behavior:'smooth', block:'start'});
}

// Check which systems are available for given dimensions
function getAvailableSystems(width, projection, mounting) {
  const available = new Set();

  // SB 400
  if (width <= 4000 && projection >= 3400 && projection <= 7000) available.add('sb400');

  // SB 400R
  if (width <= 4000 && projection >= 3400 && projection <= 7000) available.add('sb400r');

  // SB 550 — multi-module, max 3 × 5000 = 15000 мм
  if (projection >= 2580 && projection <= 6980 && width <= 15000) available.add('sb550');

  // SB 450 — таблица только до 3000 мм ширины
  if (width <= 3000 && projection >= 1930 && projection <= 6010) available.add('sb450');

  // SB 350 — только 3500 мм ширины, вынос 3400–4750
  if (width <= 3500 && projection >= 3400 && projection <= 4750) available.add('sb350');

  // Solid — multi-module, max 3 × 4000 = 12000 мм
  if (projection >= 3000 && projection <= 7000 && width <= 12000) available.add('solid');

  return available;
}


// Checkbox styling
document.querySelectorAll('.checkbox-item input').forEach(cb => {
  cb.addEventListener('change', function() {
    this.closest('.checkbox-item').classList.toggle('checked', this.checked);
  });
});
