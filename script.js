let client = null;
let currentUsername = null;
let isConnecting = false;
let isConnected = false;
let currentMessages = [];
const socket = io();

// Pages
const loginPage = document.getElementById('loginPage');
const dashboardPage = document.getElementById('dashboardPage');
const loginError = document.getElementById('loginError');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');

// Status
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

// Dashboard
const messagesDiv = document.getElementById('messages');
const msgInput = document.getElementById('publishMessage');
const sendBtn = document.getElementById('sendBtn');
const downloadBtn = document.getElementById('downloadBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userInfo = document.getElementById('currentUser');

// Register Service Worker with update handling
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/serviceworker.js')
      .then(reg => {
        console.log('✅ Service Worker registered:', reg.scope);

        // Listen for updates
        reg.onupdatefound = () => {
          const newSW = reg.installing;
          newSW.onstatechange = () => {
            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('🔄 New version available! Reloading...');
              // Auto-reload (or prompt user)
              window.location.reload();
            }
          };
        };
      })
      .catch(err => console.error('❌ SW registration failed:', err));
  });
}


// Hardcoded users
const users = {
  Tesla1: 'Tesla111',
  Tesla2: 'Tesla222',
  Tesla3: 'Tesla333'
};

// ---------- Button Helpers ----------
function showButtonLoading(button, text = "Please wait...") {
  button.disabled = true;
  button.innerHTML = `
    <span class="loading">
      <span class="spinner"></span>
      ${text}
    </span>
  `;
}

function resetButton(button, text) {
  button.disabled = false;
  button.textContent = text;
}

// ---------- Status Helpers ----------
function setLoginStatus(status) {
  if (status === 'connected') {
    statusDot.className = 'dot green';
    statusText.textContent = 'Connected';
  } else if (status === 'connecting') {
    statusDot.className = 'dot orange';
    statusText.innerHTML = '<div class="loading"><div class="spinner"></div>Connecting...</div>';
  } else {
    statusDot.className = 'dot red';
    statusText.textContent = 'Disconnected';
  }
}

// ---------- Server Communication ----------
async function loadMessagesFromServer(topic) {
  try {
    console.log('🔄 Loading messages for topic:', topic);
    const response = await fetch(`/messages/${encodeURIComponent(topic)}?limit=10`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('📥 Received data from server:', data);
    
    if (data.success && data.messages) {
      console.log('✅ Loaded', data.messages.length, 'messages from server');
      currentMessages = data.messages.map(m => ({
        timestamp: m.timestamp,
        topic: m.topic,
        msg: m.message,
        sender: m.sender || m.username,
        messageType: determineMessageType(m.message, m.sender || m.username)
      }));
      renderMessages();
    } else {
      console.warn('⚠️ No messages found');
      currentMessages = [];
      renderMessages();
    }
  } catch (error) {
    console.error('❌ Error loading messages from server:', error);
    currentMessages = [];
    renderMessages();
  }
}

async function loadUserState(username) {
  try {
    console.log('🔄 Loading state for user:', username);
    const response = await fetch(`/load-state/${encodeURIComponent(username)}`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('📥 Loaded user state:', data);
    
    if (data.success && data.state) {
      const state = data.state;
      
      // Restore switch state
      const toggleSwitch = document.getElementById('toggleSwitch');
      if (toggleSwitch) {
        toggleSwitch.checked = state.switchState;
      }
      
      // Restore indicator value
      const indicator = document.getElementById('indicator');
      if (indicator) {
        indicator.textContent = state.indicatorValue || '000';
      }
      
      // Button always starts as OFF (momentary button)
      const toggleBtn = document.getElementById('toggleBtn');
      if (toggleBtn) {
        toggleBtn.classList.remove('on');
      }
      
      console.log('✅ User state restored successfully');
    }
  } catch (error) {
    console.error('❌ Error loading user state:', error);
    setDefaultStates();
  }
}

async function saveUserState(username, buttonState, switchState, indicatorValue) {
  try {
    const response = await fetch('/save-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        username, 
        buttonState, 
        switchState, 
        indicatorValue 
      })
    });
    
    if (response.ok) {
      console.log('✅ User state saved to server');
    }
  } catch (error) {
    console.error('❌ Error saving user state:', error);
  }
}

function setDefaultStates() {
  const toggleSwitch = document.getElementById('toggleSwitch');
  const indicator = document.getElementById('indicator');
  const toggleBtn = document.getElementById('toggleBtn');
  
  if (toggleSwitch) toggleSwitch.checked = false;
  if (indicator) indicator.textContent = '000';
  if (toggleBtn) {
    toggleBtn.classList.remove('on');
  }
}

async function saveMessageToServer(entry) {
  try {
    const response = await fetch('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        timestamp: entry.timestamp, 
        topic: entry.topic, 
        payload: entry.msg, 
        username: currentUsername, 
        sender: entry.sender 
      })
    });
    
    if (response.ok) {
      console.log('✅ Message saved to server');
    }
  } catch (error) {
    console.error('❌ Error saving message to server:', error);
  }
}

// ---------- FIXED: Message Type Determination ----------
function determineMessageType(message, sender) {
  // Control commands (orange)
  if (message.startsWith('[CONTROL]')) {
    return 'control';
  }
  
  // FIXED: Direct component control (light blue) - both button and switch
  if (message.includes('Manual Button Press') || message.includes('Manual Switch:')) {
    return 'component';
  }
  
  // Messages sent by current user (green)
  if (sender === currentUsername) {
    return 'sent';
  }
  
  // Messages from other users (default)
  return 'received';
}

// ---------- Authentication ----------
function handleLogin(e) {
  e.preventDefault();
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  showButtonLoading(document.getElementById('loginBtn'), "Connecting...");
  setLoginStatus('connecting');

  setTimeout(async () => {
    if (users[username] && users[username] === password) {
      loginError.classList.add('hidden');
      loginPage.classList.add('hidden');
      dashboardPage.classList.remove('hidden');
      userInfo.textContent = username;
      currentUsername = username;

      sessionStorage.setItem("lastPage", "dashboard");
      sessionStorage.setItem("username", username);

      await loadUserState(username);
      await loadMessagesFromServer(username);

      connectAndSubscribe(username);
      resetButton(document.getElementById('loginBtn'), "Connect & Subscribe");
    } else {
      loginError.textContent = 'Invalid username or password';
      loginError.classList.remove('hidden');
      setLoginStatus('disconnected');
      resetButton(document.getElementById('loginBtn'), "Connect & Subscribe");
    }
  }, 400);
}

function logout() {
  showButtonLoading(logoutBtn, "Disconnecting...");
  
  if (currentUsername) {
    const toggleBtn = document.getElementById('toggleBtn');
    const toggleSwitch = document.getElementById('toggleSwitch');
    const indicator = document.getElementById('indicator');
    
    const buttonState = toggleBtn ? toggleBtn.textContent : 'OFF';
    const switchState = toggleSwitch ? toggleSwitch.checked : false;
    const indicatorValue = indicator ? indicator.textContent : '000';
    
    saveUserState(currentUsername, buttonState, switchState, indicatorValue);
  }

  setTimeout(() => {
    disconnect();
    currentUsername = null;
    currentMessages = [];
    isConnected = false;
    isConnecting = false;
    loginPage.classList.remove('hidden');
    dashboardPage.classList.add('hidden');
    usernameInput.value = '';
    passwordInput.value = '';
    messagesDiv.innerHTML = '<div style="text-align:center;color:#6b7280;padding:40px;">No messages yet. Send a message to get started!</div>';
    userInfo.textContent = '';
    setLoginStatus('disconnected');
    sessionStorage.setItem("lastPage", "login");
    sessionStorage.removeItem("username");
    resetButton(logoutBtn, "Disconnect");
    
    setDefaultStates();
  }, 500);
}

// ---------- MQTT ----------
function connectAndSubscribe(topic) {
  if (!topic) return;
  if (isConnecting || isConnected) return;
  
  isConnecting = true;
  isConnected = false;

  const url = 'wss://broker.hivemq.com:8884/mqtt';
  const clientId = `${currentUsername}_${Math.random().toString(16).slice(2)}`;

  try {
    client = mqtt.connect(url, {
      clientId,
      keepalive: 60,
      connectTimeout: 10000,
      reconnectPeriod: 0
    });
  } catch (e) {
    alert('Failed to create MQTT client: ' + e.message);
    isConnecting = false;
    return;
  }

  client.on('connect', () => {
    isConnecting = false;
    isConnected = true;
    setLoginStatus('connected');
    sendBtn.disabled = false;
    
    client.subscribe(topic, (err) => {
      if (err) {
        alert('Subscribe failed: ' + err.message);
      } else {
        console.log(`Subscribed to topic: ${topic}`);
		socket.emit('joinTopic', topic);
      }
    });
  });

  client.on('message', (receivedTopic, message) => {
    const payload = message.toString();
    let msg = payload;
    let sender = receivedTopic;

    if (payload.includes(':')) {
      const colonIndex = payload.indexOf(':');
      sender = payload.substring(0, colonIndex).trim();
      msg = payload.substring(colonIndex + 1).trim();
    }

    // Process control commands AND manual component actions
    if (processControlCommand(msg, sender)) {
      addMessage(receivedTopic, `[CONTROL] ${msg}`, sender, 'control');
    } else if (processManualComponentAction(msg, sender)) {
      // FIXED: Process manual component actions and sync across devices
      const messageType = determineMessageType(payload, sender);
      addMessage(receivedTopic, payload, sender, messageType);
    } else {
      const messageType = determineMessageType(msg, sender);
      addMessage(receivedTopic, msg, sender, messageType);
    }
  });

  client.on('close', () => {
    isConnecting = false;
    isConnected = false;
    setLoginStatus('disconnected');
    sendBtn.disabled = true;
  });

  client.on('error', (e) => {
    alert('MQTT connection error: ' + e.message);
    isConnecting = false;
    isConnected = false;
    setLoginStatus('disconnected');
  });
}

function disconnect() {
  if (client) {
    try {
      client.end(true);
    } catch (e) {
      console.error('Error disconnecting:', e);
    }
    client = null;
  }
  isConnected = false;
  isConnecting = false;
  setLoginStatus('disconnected');
  sendBtn.disabled = true;
}

// ---------- NEW: Manual Component Action Processing ----------
function processManualComponentAction(fullMessage, sender) {
  // Check if it's a manual component action from another device
  if (sender !== currentUsername) {
    if (fullMessage.includes('Manual Switch:')) {
      const state = fullMessage.includes('Manual Switch: ON');
      setSwitch(state, false); // Don't save state to avoid loop
      console.log(`🔄 Remote switch change received: ${state ? 'ON' : 'OFF'}`);
      return true;
    }
  }
  return false;
}

// ---------- Control Command Processing ----------
function processControlCommand(command, sender = null) {
  const cmd = command.trim().toUpperCase();
  
  // Individual commands
  if (cmd.startsWith('SX')) {
    if (cmd === 'SX00') {
      setSwitch(false, false);
      return true;
    } else if (cmd === 'SXFF') {
      setSwitch(true, false);
      return true;
    }
  }
  
  if (cmd.startsWith('INX')) {
    const numberPart = cmd.substring(3);
    if (numberPart.length === 3 && /^\d{3}$/.test(numberPart)) {
      setIndicator(parseInt(numberPart, 10), false);
      return true;
    }
  }
  
  // Combined command: FF00123
  if (/^[0-9A-F]{2}[0-9A-F]{2}\d{3}$/.test(cmd)) {
    const buttonCmd = cmd.substring(0, 2);
    const switchCmd = cmd.substring(2, 4);
    const indicatorValue = parseInt(cmd.substring(4, 7), 10);
        
    if (switchCmd === '00') {
      setSwitch(false, false);
    } else if (switchCmd === 'FF') {
      setSwitch(true, false);
    }
    
    setIndicator(indicatorValue, false);
    
    if (sender && sender !== currentUsername) {
      saveCurrentUserState();
    }
    
    return true;
  }
  
  return false;
}
function setSwitch(state, saveState = true) {
  const toggleSwitch = document.getElementById('toggleSwitch');
  if (toggleSwitch) {
    toggleSwitch.checked = state;   // updates when SX00/SXFF arrives
    console.log(`🎛️ Switch set to: ${state ? 'ON' : 'OFF'}`);

    if (saveState) saveCurrentUserState();
  }
}


function momentaryButtonPress(saveState = true) {
  const toggleBtn = document.getElementById('toggleBtn');
  if (toggleBtn) {
    // 🔘 Turn green
    toggleBtn.classList.add('on');

    setTimeout(() => {
      // 🔘 Back to gray
      toggleBtn.classList.remove('on');
      if (saveState) saveCurrentUserState();
    }, 500);
  }
}

function setIndicator(value, saveState = true) {
  const indicator = document.getElementById('indicator');
  if (indicator) {
    const displayValue = value.toString().padStart(3, '0');
    indicator.textContent = displayValue;
    console.log(`📊 Indicator set to: ${displayValue}`);
    
    if (saveState) {
      saveCurrentUserState();
    }
  }
}

function saveCurrentUserState() {
  if (!currentUsername) return;
  
  const toggleBtn = document.getElementById('toggleBtn');
  const toggleSwitch = document.getElementById('toggleSwitch');
  const indicator = document.getElementById('indicator');
  
  const buttonState = toggleBtn ? toggleBtn.textContent : 'OFF';
  const switchState = toggleSwitch ? toggleSwitch.checked : false;
  const indicatorValue = indicator ? indicator.textContent : '000';
  
  saveUserState(currentUsername, buttonState, switchState, indicatorValue);
}

// ---------- Messages ----------
function addMessage(topic, msg, sender = currentUsername, messageType = null) {
  const timestamp = new Date().toISOString();
  const type = messageType || determineMessageType(msg, sender);
  const entry = { timestamp, topic, msg, sender, messageType: type };
  
  currentMessages.push(entry);
  currentMessages = currentMessages.slice(-10);
  
  renderMessages();
  saveMessageToServer(entry);
}

// ---------- Message Rendering with Colors ----------
function renderMessages() {
  if (currentMessages.length === 0) {
    messagesDiv.innerHTML = '<div style="text-align:center;color:#6b7280;padding:40px;">No messages yet. Send a message to get started!</div>';
    return;
  }

  messagesDiv.innerHTML = '';
  currentMessages.forEach(m => {
    const div = document.createElement('div');
    div.className = 'msg';
    
    // Apply message type styling
    switch (m.messageType) {
      case 'control':
        // Control commands - Orange
        div.style.backgroundColor = '#fef3c7';
        div.style.borderLeft = '4px solid #f59e0b';
        break;
      case 'sent':
        // Messages sent by current user - Green
        div.style.backgroundColor = '#dcfce7';
        div.style.borderLeft = '4px solid #22c55e';
        break;
      case 'component':
        // Direct component control - Light Blue
        div.style.backgroundColor = '#dbeafe';
        div.style.borderLeft = '4px solid #3b82f6';
        break;
      default:
        // Received messages - Default white
        div.style.backgroundColor = '#ffffff';
        div.style.borderLeft = '4px solid #e5e7eb';
    }
    
    const senderText = m.sender ? `${m.sender}: ` : '';
    div.innerHTML = `
      <div class="msg-header">
        <span>${new Date(m.timestamp).toLocaleString()}</span>
        <span class="msg-topic">${m.topic}</span>
      </div>
      <div class="msg-body">${senderText}${m.msg}</div>
    `;
    messagesDiv.appendChild(div);
  });
  
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// ---------- Event Listeners ----------
document.getElementById('loginBtn').addEventListener('click', handleLogin);
logoutBtn.addEventListener('click', logout);

sendBtn.addEventListener('click', () => {
  if (client && isConnected && currentUsername) {
    const msg = msgInput.value.trim();
    if (msg) {
      showButtonLoading(sendBtn, "Sending...");
      const fullMsg = `${currentUsername}: ${msg}`;
      client.publish(currentUsername, fullMsg);
      msgInput.value = '';
      setTimeout(() => resetButton(sendBtn, "Send"), 400);
    }
  } else {
    alert('Not connected to MQTT broker. Please connect first.');
  }
});

msgInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendBtn.click();
});

downloadBtn.addEventListener('click', () => {
  if (currentMessages.length === 0) {
    alert('No messages to download.');
    return;
  }

  showButtonLoading(downloadBtn, "Downloading...");
  
  const header = 'Timestamp,Topic,Sender,Message,Type\n';
  const csv = currentMessages.map(m => {
    const sender = m.sender || 'unknown';
    const message = (m.msg || '').replace(/"/g, '""');
    const type = m.messageType || 'received';
    return `${m.timestamp},${m.topic},"${sender}","${message}","${type}"`;
  }).join('\n');

  const blob = new Blob([header + csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentUsername}_messages.csv`;
  a.click();
  URL.revokeObjectURL(url);
  
  setTimeout(() => resetButton(downloadBtn, "Download CSV"), 500);
});

// ---------- Page Restore ----------
document.addEventListener('DOMContentLoaded', async () => {
  const lastPage = sessionStorage.getItem("lastPage");
  const savedUser = sessionStorage.getItem("username");
  
  if (lastPage === "dashboard" && savedUser) {
    // Restore Dashboard
    loginPage.classList.add("hidden");
    dashboardPage.classList.remove("hidden");
    currentUsername = savedUser;
    userInfo.textContent = savedUser;
    
    // ✅ Keep MQTT alive (auto-reconnect if needed)
    if (!isConnected && !isConnecting) {
      connectAndSubscribe(savedUser);
    } else {
      setLoginStatus('connected');
    }

    // ✅ Refresh messages only
    await loadMessagesFromServer(savedUser);
	connectAndSubscribe(savedUser);
  } else {
    // Default: back to login page
    loginPage.classList.remove("hidden");
    dashboardPage.classList.add("hidden");
    sessionStorage.setItem("lastPage", "login");
    setDefaultStates();
  }
});

// ---------- FIXED: Manual Controls ----------
// ---------- Circle Button (momentary) ----------
const toggleBtn = document.getElementById("toggleBtn");

if (toggleBtn) {
  toggleBtn.addEventListener("click", () => {
    if (client && isConnected && currentUsername) {
      // Turn the button green immediately
      toggleBtn.classList.add("on");

      // 1) Publish ON
      const msgOn = "S01ON";
      client.publish(currentUsername, `${currentUsername}: ${msgOn}`);
      console.log("📡 Published:", msgOn);

      // 2) After 500ms, publish OFF and reset button color
      setTimeout(() => {
        const msgOff = "S01OFF";
        client.publish(currentUsername, `${currentUsername}: ${msgOff}`);
        console.log("📡 Published:", msgOff);

        toggleBtn.classList.remove("on"); // back to gray
      }, 500);
    }
  });
}

const toggleSwitch = document.getElementById('toggleSwitch');
if (toggleSwitch) {
  toggleSwitch.addEventListener('change', () => {
    const state = toggleSwitch.checked ? "ON" : "OFF";
    
    if (client && isConnected && currentUsername) {
      // FIXED: Send with consistent username prefix format
      const message = `${currentUsername}: Manual Switch: ${state}`;
      client.publish(currentUsername, message);
      console.log('📡 Published switch change:', message);
    }
    
    saveCurrentUserState();
  });
}

const userCountElement = document.getElementById('userCount');

socket.on('userCountUpdate', (count) => {
  if (userCountElement) {
    userCountElement.textContent = `Active Users: ${count}`;
  }
});


// ---------- NEW: TextBox Controls (TB1–TB5) ----------
function setTextboxValue(tbId) {
  const input = document.getElementById(tbId);
  let value = input.value.trim();

  // ✅ Validate integer with 1–3 digits (1–999)
  if (!/^\d{1,3}$/.test(value)) {
    alert("Please enter a valid number between 1 and 999.");
    input.focus();
    return;
  }

  const message = `${tbId}${value.padStart(3, '0')}`; // always 3-digit format

  // ✅ Publish to MQTT broker
  if (client && isConnected && currentUsername) {
    const fullMsg = `${currentUsername}: ${message}`;
    client.publish(currentUsername, fullMsg);
    console.log(`📡 Published from ${tbId}:`, fullMsg);
  }

  // ✅ Save to server
  saveMessageToServer({
    timestamp: new Date().toISOString(),
    topic: currentUsername,
    msg: message,
    sender: currentUsername
  });
}
// =========================================
// TIMER BOARD CONTROLS (Updated)
// =========================================

// Command Box direct send
function sendCommandDirect(cmdNum) {
  const input = document.getElementById(`CMD${cmdNum}`);
  let value = input.value.trim();

  if (value.length === 0) {
    alert("Please enter a valid command.");
    input.focus();
    return;
  }
  if (value.length > 15) {
    alert("Command too long (max 15 characters).");
    input.focus();
    return;
  }

   // Send only the command text (no prefix)
  const message = value;

  if (client && isConnected && currentUsername) {
    const fullMsg = `${currentUsername}: ${message}`;
    client.publish(currentUsername, fullMsg);
    console.log(`📡 Published Command ${cmdNum}:`, fullMsg);
  }

  saveMessageToServer({
    timestamp: new Date().toISOString(),
    topic: currentUsername,
    msg: message,
    sender: currentUsername
  });

  console.log(`✅ Sent command (kept in input): ${message}`);
}

// Copy command to main message box (no prefix)
function copyCommandToMain(cmdNum) {
  const input = document.getElementById(`CMD${cmdNum}`);
  const mainInput = document.getElementById('publishMessage');
  
  let value = input.value.trim();
  if (value.length === 0) {
    alert("Please enter a valid command to copy.");
    input.focus();
    return;
  }

  mainInput.value = value;
  mainInput.focus();
  console.log(`📋 Copied command: ${value}`);
}





function copyTimerToMain(tbNum) {
  const input = document.getElementById(`TM${tbNum}`);
  const mainInput = document.getElementById('publishMessage');
  
  let value = input.value.trim();

  if (!/^\d{1,3}$/.test(value)) {
    alert("Please enter a valid number between 1 and 999.");
    input.focus();
    return;
  }

  const message = `TM${tbNum}${value.padStart(3, '0')}`;
  mainInput.value = message;
  mainInput.focus();
  
  console.log(`📋 Copied to main: ${message}`);
}

// Mode switch buttons
function sendModeCommand(modeNum) {
  // Format: MODE# where # is 1-4
  const message = `MODE${modeNum}`;

  if (client && isConnected && currentUsername) {
    const fullMsg = `${currentUsername}: ${message}`;
    client.publish(currentUsername, fullMsg);
    console.log(`📡 Published Mode Switch:`, fullMsg);
  }

  saveMessageToServer({
    timestamp: new Date().toISOString(),
    topic: currentUsername,
    msg: message,
    sender: currentUsername
  });
}

// Restrict Timer textboxes to numbers only
["TM1", "TM2", "TM3", "TM4"].forEach(id => {
  const input = document.getElementById(id);
  if (input) {
    input.addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/\D/g, "").slice(0, 3);
    });
  }
});

// ---------- Restrict TextBoxes to numbers only ----------
["TB1", "TB2", "TB3", "TB4", "TB5"].forEach(id => {
  const input = document.getElementById(id);
  if (input) {
    input.addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/\D/g, "").slice(0, 3); // only digits, max 3
    });
  }
});
