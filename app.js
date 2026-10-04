const STORAGE_KEY = 'tasmotaSavedAddresses';

const state = {
  baseUrl: '',
  connected: false,
  devices: [],
  groups: [],
  logs: []
};

const els = {
  savedAddresses: document.getElementById('savedAddresses'),
  protocol: document.getElementById('protocol'),
  ipAddress: document.getElementById('ipAddress'),
  port: document.getElementById('port'),
  username: document.getElementById('username'),
  password: document.getElementById('password'),
  connectionBadge: document.getElementById('connectionBadge'),
  connectionText: document.getElementById('connectionText'),
  connectBtn: document.getElementById('connectBtn'),
  saveAddressBtn: document.getElementById('saveAddressBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  rescanBtn: document.getElementById('rescanBtn'),
  devicesList: document.getElementById('devicesList'),
  groupsList: document.getElementById('groupsList'),
  targetType: document.getElementById('targetType'),
  targetSelection: document.getElementById('targetSelection'),
  brightnessSlider: document.getElementById('brightnessSlider'),
  tempSlider: document.getElementById('tempSlider'),
  colorPicker: document.getElementById('colorPicker'),
  customCommand: document.getElementById('customCommand'),
  sendCustomBtn: document.getElementById('sendCustomBtn'),
  clearLogBtn: document.getElementById('clearLogBtn'),
  logOutput: document.getElementById('logOutput'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody'),
  closeModalBtn: document.getElementById('closeModalBtn')
};

function getSavedAddresses() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveAddresses(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function populateAddressSelect() {
  const saved = getSavedAddresses();
  const currentValue = els.savedAddresses.value;

  els.savedAddresses.innerHTML = '<option value="">-- seleziona --</option>';

  saved.forEach((entry) => {
    const option = document.createElement('option');
    option.value = `${entry.protocol}://${entry.ip}:${entry.port}`;
    option.textContent = `${entry.protocol}://${entry.ip}:${entry.port}`;
    if (currentValue === option.value) option.selected = true;
    els.savedAddresses.appendChild(option);
  });

  if (!currentValue && saved.length > 0) {
    const first = saved[0];
    els.savedAddresses.value = `${first.protocol}://${first.ip}:${first.port}`;
  }

  const selected = els.savedAddresses.value;
  if (selected) {
    const match = selected.match(/^(https?):\/\/([^:]+):(\d+)/i);
    if (match) {
      els.protocol.value = match[1].toLowerCase();
      els.ipAddress.value = match[2];
      els.port.value = match[3];
    }
  }
}

function showStatus(connected, text) {
  els.connectionBadge.classList.toggle('online', connected);
  els.connectionBadge.classList.toggle('offline', !connected);
  els.connectionText.textContent = text;
}

function addLog(message, type = 'info') {
  const entry = {
    timestamp: new Date().toLocaleTimeString('it-IT'),
    type,
    message
  };

  state.logs.unshift(entry);
  if (state.logs.length > 150) state.logs.pop();

  renderLogs();
}

function renderLogs() {
  if (!state.logs.length) {
    els.logOutput.textContent = 'Nessun evento.';
    return;
  }

  els.logOutput.innerHTML = state.logs
    .map(
      (log) =>
        `<div class="log-entry ${log.type}">
          <span class="timestamp">${log.timestamp}</span>
          <span>${log.message}</span>
        </div>`
    )
    .join('');
}

function clearLogs() {
  state.logs = [];
  renderLogs();
}

function setBaseUrlFromInputs() {
  const protocol = els.protocol.value || 'http';
  const ip = (els.ipAddress.value || '').trim();
  const port = (els.port.value || '80').trim();
  if (!ip) return '';
  return `${protocol}://${ip}:${port}`;
}

async function fetchJsonViaProxy(tasmotaUrl, username, password) {
  const params = new URLSearchParams({
    url: tasmotaUrl,
    ...(username && { username }),
    ...(password && { password })
  });

  const response = await fetch(`/api/tasmota?${params}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }

  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function connectDevice() {
  const baseUrl = setBaseUrlFromInputs();
  if (!baseUrl) {
    alert('Inserisci un indirizzo IP valido del Tasmota.');
    return;
  }

  state.baseUrl = baseUrl;

  try {
    const statusUrl = `${baseUrl}/cm?cmnd=Status`;
    const payload = await fetchJsonViaProxy(statusUrl, els.username.value, els.password.value);

    if (!payload || (!payload.Status && !payload.status && !payload.data)) {
      throw new Error('La risposta del dispositivo non contiene dati Tasmota validi.');
    }

    state.connected = true;
    showStatus(true, `Connesso: ${baseUrl}`);
    addLog(`Connesso a ${baseUrl}`, 'success');

    await refreshData();
  } catch (error) {
    state.connected = false;
    showStatus(false, 'Disconnesso');
    addLog(`Errore connessione: ${error.message}`, 'error');
    alert(`Impossibile collegarsi al Tasmota: ${error.message}`);
  }
}

function parseDevicesFromPayload(payload) {
  const items = [];

  const addCandidate = (candidate) => {
    if (!candidate || typeof candidate !== 'object') return;

    const name =
      candidate.Name ||
      candidate.Device ||
      candidate.DeviceName ||
      candidate.name ||
      candidate.FriendlyName ||
      'Device';

    const kind =
      candidate.Type ||
      candidate.DeviceType ||
      candidate.Model ||
      candidate.model ||
      'Unknown';

    const stateValue =
      candidate.Status ||
      candidate.Power ||
      candidate.State ||
      candidate.state;

    const value =
      typeof stateValue === 'boolean'
        ? stateValue ? 'ON' : 'OFF'
        : stateValue || 'UNKNOWN';

    if (
      name &&
      (candidate.IEEEAddr || candidate.ShortAddr || candidate.Device || candidate.Name || candidate.Type)
    ) {
      items.push({
        id: candidate.IEEEAddr || candidate.ShortAddr || candidate.Device || name,
        name,
        type: kind,
        state: String(value).toUpperCase(),
        address: candidate.IEEEAddr || candidate.ShortAddr || 'N/A'
      });
    }
  };

  const walk = (value) => {
    if (!value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    Object.values(value).forEach((item) => {
      if (item && typeof item === 'object') {
        addCandidate(item);
        walk(item);
      }
    });
  };

  walk(payload);

  const unique = [];
  const seen = new Set();

  items.forEach((item) => {
    const key = `${item.id}-${item.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  });

  return unique;
}

function parseGroupsFromPayload(payload) {
  const groups = [];

  const walk = (value) => {
    if (!value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    Object.values(value).forEach((item) => {
      if (item && typeof item === 'object') {
        const groupName = item.GroupName || item.name || item.Name;
        const groupId = item.GroupId || item.ID || item.id;

        if (groupName || groupId !== undefined) {
          groups.push({
            id: String(groupId ?? groupName),
            name: String(groupName || `Gruppo ${groupId ?? 'N'}`),
            type: 'Group'
          });
        }

        walk(item);
      }
    });
  };

  walk(payload);

  const unique = [];
  const seen = new Set();

  groups.forEach((group) => {
    const key = `${group.id}-${group.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(group);
    }
  });

  return unique;
}

async function refreshData() {
  if (!state.connected) return;

  try {
    const zbStatusUrl = `${state.baseUrl}/zb?cmnd=ZbStatus`;
    const zbStatus = await fetchJsonViaProxy(zbStatusUrl, els.username.value, els.password.value);
    const devices = parseDevicesFromPayload(zbStatus);
    state.devices = devices;
    renderDevices();

    const groupsUrl = `${state.baseUrl}/zb?cmnd=ZbStatus%201`;
    const groupsPayload = await fetchJsonViaProxy(groupsUrl, els.username.value, els.password.value).catch(() => ({}));
    state.groups = parseGroupsFromPayload(groupsPayload);
    renderGroups();

    updateTargetSelection();
    addLog(`Aggiornati ${devices.length} dispositivi e ${state.groups.length} gruppi`, 'info');
  } catch (error) {
    addLog(`Errore refresh: ${error.message}`, 'error');
  }
}

function renderDevices() {
  if (!state.devices.length) {
    els.devicesList.className = 'card-list empty';
    els.devicesList.textContent = 'Nessun dispositivo trovato.';
    return;
  }

  els.devicesList.className = 'card-list';
  els.devicesList.innerHTML = state.devices
    .map(
      (device) => `
        <div class="device-card" data-device-id="${device.id}" data-name="${device.name}">
          <div class="card-top">
            <strong>${device.name}</strong>
            <span class="type-pill">${device.type}</span>
          </div>
          <div class="meta-row">
            <span>Indirizzo</span>
            <span>${device.address}</span>
          </div>
          <div class="meta-row">
            <span>Stato</span>
            <span class="state ${device.state.toLowerCase()}">${device.state}</span>
          </div>
        </div>
      `
    )
    .join('');

  els.devicesList.querySelectorAll('.device-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.deviceId;
      els.targetType.value = 'device';
      updateTargetSelection();
      els.targetSelection.value = id;
    });
  });
}

function renderGroups() {
  if (!state.groups.length) {
    els.groupsList.className = 'card-list empty';
    els.groupsList.textContent = 'Nessun gruppo trovato.';
    return;
  }

  els.groupsList.className = 'card-list';
  els.groupsList.innerHTML = state.groups
    .map(
      (group) => `
        <div class="device-card" data-group-id="${group.id}" data-name="${group.name}">
          <div class="card-top">
            <strong>${group.name}</strong>
            <span class="type-pill">${group.type}</span>
          </div>
          <div class="meta-row">
            <span>ID</span>
            <span>${group.id}</span>
          </div>
        </div>
      `
    )
    .join('');

  els.groupsList.querySelectorAll('.device-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.groupId;
      els.targetType.value = 'group';
      updateTargetSelection();
      els.targetSelection.value = id;
    });
  });
}

function updateTargetSelection() {
  const type = els.targetType.value;
  const items = type === 'device' ? state.devices : state.groups;

  els.targetSelection.innerHTML = '<option value="">-- seleziona --</option>';

  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    els.targetSelection.appendChild(option);
  });
}

async function sendCommandToTarget(command, value) {
  const selectedTarget = els.targetSelection.value;
  const targetType = els.targetType.value;

  if (!selectedTarget) {
    alert('Seleziona prima un dispositivo o un gruppo.');
    return;
  }

  if (!state.connected) {
    alert('Prima connettiti a un Tasmota.');
    return;
  }

  try {
    const commandText = `${command} ${value}`.trim();
    let cmdUrl = '';

    if (targetType === 'device') {
      cmdUrl = `${state.baseUrl}/zb?cmnd=${encodeURIComponent(
        `ZbSend {"Device":"${selectedTarget}","Send":"${commandText}"}`
      )}`;
    } else {
      cmdUrl = `${state.baseUrl}/zb?cmnd=${encodeURIComponent(
        `ZbSend {"Group":"${selectedTarget}","Send":"${commandText}"}`
      )}`;
    }

    const result = await fetchJsonViaProxy(cmdUrl, els.username.value, els.password.value);
    addLog(`Comando inviato: ${commandText} a ${targetType} ${selectedTarget}`, 'success');
    showModal('Risultato comando', JSON.stringify(result, null, 2));
    setTimeout(refreshData, 600);
  } catch (error) {
    addLog(`Errore comando ${command} ${value}: ${error.message}`, 'error');
    alert(`Errore di invio: ${error.message}`);
  }
}

async function sendCustomCommand() {
  const commandText = (els.customCommand.value || '').trim();
  if (!commandText) {
    alert('Inserisci un comando Tasmota valido.');
    return;
  }

  const [command, ...rest] = commandText.split(/\s+/);
  const value = rest.join(' ');

  await sendCommandToTarget(command, value || '');
  els.customCommand.value = '';
}

function showModal(title, body) {
  els.modalTitle.textContent = title;
  els.modalBody.textContent = body;
  els.modal.classList.remove('hidden');
  els.modal.setAttribute('aria-hidden', 'false');
}

function hideModal() {
  els.modal.classList.add('hidden');
  els.modal.setAttribute('aria-hidden', 'true');
}

function saveCurrentAddress() {
  const protocol = els.protocol.value || 'http';
  const ip = (els.ipAddress.value || '').trim();
  const port = Number(els.port.value || 80);

  if (!ip) {
    alert('Inserisci un indirizzo IP valido.');
    return;
  }

  const saved = getSavedAddresses();
  const entry = { protocol, ip, port };
  const next = saved.filter((item) => !(item.ip === ip && item.port === port && item.protocol === protocol));
  next.unshift(entry);
  saveAddresses(next.slice(0, 10));

  populateAddressSelect();
  els.savedAddresses.value = `${protocol}://${ip}:${port}`;

  addLog(`Indirizzo salvato: ${protocol}://${ip}:${port}`, 'info');
}

function bindEvents() {
  els.connectBtn.addEventListener('click', connectDevice);
  els.saveAddressBtn.addEventListener('click', saveCurrentAddress);
  els.refreshBtn.addEventListener('click', refreshData);
  els.rescanBtn.addEventListener('click', refreshData);
  els.targetType.addEventListener('change', updateTargetSelection);
  els.sendCustomBtn.addEventListener('click', sendCustomCommand);
  els.clearLogBtn.addEventListener('click', clearLogs);
  els.closeModalBtn.addEventListener('click', hideModal);

  els.modal.addEventListener('click', (event) => {
    if (event.target === els.modal) hideModal();
  });

  els.savedAddresses.addEventListener('change', () => {
    const value = els.savedAddresses.value;
    if (!value) return;

    const match = value.match(/^(https?):\/\/([^:]+):(\d+)/i);
    if (match) {
      els.protocol.value = match[1].toLowerCase();
      els.ipAddress.value = match[2];
      els.port.value = match[3];
    }
  });

  document.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('click', () => {
      const command = button.dataset.command;
      const value = button.dataset.value;
      sendCommandToTarget(command, value);
    });
  });

  els.brightnessSlider.addEventListener('input', () => {
    sendCommandToTarget('Dimmer', els.brightnessSlider.value);
  });

  els.tempSlider.addEventListener('input', () => {
    sendCommandToTarget('CT', els.tempSlider.value);
  });

  els.colorPicker.addEventListener('input', () => {
    const color = els.colorPicker.value;
    const r = Number.parseInt(color.slice(1, 3), 16);
    const g = Number.parseInt(color.slice(3, 5), 16);
    const b = Number.parseInt(color.slice(5, 7), 16);

    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const delta = max - min;

    let h = 0;
    if (delta !== 0) {
      if (max === r / 255) h = ((g / 255) - (b / 255)) / delta;
      else if (max === g / 255) h = 2 + ((b / 255) - (r / 255)) / delta;
      else h = 4 + ((r / 255) - (g / 255)) / delta;
      h *= 60;
      if (h < 0) h += 360;
    }

    sendCommandToTarget('Hue', Math.round(h));
  });

  els.customCommand.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') sendCustomCommand();
  });
}

function init() {
  populateAddressSelect();
  bindEvents();
  updateTargetSelection();
  renderLogs();

  const saved = getSavedAddresses();
  if (saved.length > 0) {
    const first = saved[0];
    els.protocol.value = first.protocol;
    els.ipAddress.value = first.ip;
    els.port.value = first.port;
  }
}

init();
