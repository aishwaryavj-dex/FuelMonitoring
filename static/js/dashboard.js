// Dashboard State
let lastReadingTime = null;
let connectionCheckInterval = null;
let fallbackPollInterval = null;
let chartInstance = null;
const SVG_CIRCUMFERENCE = 339.29; // 2 * PI * 54 (radius of circles)

// UI elements
const elements = {
  connectionPill: document.getElementById('connection-pill'),
  connectionText: document.getElementById('connection-text'),
  alertBanner: document.getElementById('alert-banner'),
  alertMessage: document.getElementById('alert-message'),
  
  // Fuel
  fuelValue: document.getElementById('fuel-value'),
  fuelGaugeFill: document.getElementById('fuel-gauge-fill'),
  fuelStatus: document.getElementById('fuel-status'),
  
  // Corrosion
  corrosionValue: document.getElementById('corrosion-value'),
  corrosionGaugeFill: document.getElementById('corrosion-gauge-fill'),
  corrosionStatus: document.getElementById('corrosion-status'),
  
  // Temp
  tempValue: document.getElementById('temp-value'),
  tempRangeFill: document.getElementById('temp-range-fill'),
  
  // Humidity
  humidityValue: document.getElementById('humidity-value'),
  humidityRangeFill: document.getElementById('humidity-range-fill'),
  
  // Summary
  summaryFuel: document.getElementById('summary-fuel'),
  summaryCorrosion: document.getElementById('summary-corrosion'),
  summaryTemp: document.getElementById('summary-temp'),
  summaryHumidityRisk: document.getElementById('summary-humidity-risk'),
  summaryLastTime: document.getElementById('summary-last-time'),
  
  // Log
  eventLogContainer: document.getElementById('event-log-container')
};

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  initChart();
  loadHistory();
  initWebSocket();
  
  // Monitor connection states
  connectionCheckInterval = setInterval(checkHardwareConnectivity, 2000);
});

// ----------------------------------------------------
// WebSockets & Polling fallback
// ----------------------------------------------------
let socket;
function initWebSocket() {
  if (typeof io === 'undefined') {
    console.warn('Socket.IO client library not loaded. Falling back to REST polling.');
    updateServerConnectionStatus(false);
    startPollingFallback();
    return;
  }
  // Connect to the root Socket.IO namespace
  socket = io({
    reconnectionAttempts: 5,
    timeout: 10000
  });

  socket.on('connect', () => {
    updateServerConnectionStatus(true);
    // Cancel polling fallback if it was active
    if (fallbackPollInterval) {
      clearInterval(fallbackPollInterval);
      fallbackPollInterval = null;
    }
  });

  socket.on('new_reading', (data) => {
    handleNewReading(data);
  });

  socket.on('disconnect', () => {
    updateServerConnectionStatus(false);
    startPollingFallback();
  });

  socket.on('connect_error', () => {
    updateServerConnectionStatus(false);
    startPollingFallback();
  });
}

function startPollingFallback() {
  if (!fallbackPollInterval) {
    console.log('Switching to REST polling fallback...');
    // Immediately fetch latest once, then poll every 2s
    pollLatest();
    fallbackPollInterval = setInterval(pollLatest, 2000);
  }
}

function pollLatest() {
  fetch('/api/latest')
    .then(res => {
      if (!res.ok) throw new Error('API response not OK');
      return res.json();
    })
    .then(data => {
      updateServerConnectionStatus(true); // Server is reachable via REST
      if (data.reading) {
        handleNewReading(data.reading);
      }
    })
    .catch(err => {
      console.warn('Fallback polling failed:', err);
      updateServerConnectionStatus(false); // Server is unreachable
    });
}

// ----------------------------------------------------
// UI State Updates
// ----------------------------------------------------

// Set the connection status badge to red/green
function updateServerConnectionStatus(isReachable) {
  if (!isReachable) {
    elements.connectionPill.className = 'status-pill disconnected';
    elements.connectionText.textContent = 'Disconnected — retrying...';
  } else {
    // If browser can reach server, let checkHardwareConnectivity determine if ESP32 is sending data
    checkHardwareConnectivity();
  }
}

// Check if ESP32 uploaded data in the last 10 seconds
function checkHardwareConnectivity() {
  if (!lastReadingTime) {
    elements.connectionPill.className = 'status-pill disconnected';
    elements.connectionText.textContent = 'No Sensor Data';
    return;
  }
  
  const secondsSinceLastReading = (Date.now() - lastReadingTime.getTime()) / 1000;
  if (secondsSinceLastReading > 10.0) {
    elements.connectionPill.className = 'status-pill disconnected';
    elements.connectionText.textContent = 'Disconnected — retrying...';
  } else {
    elements.connectionPill.className = 'status-pill connected';
    elements.connectionText.textContent = 'Connected';
  }
}

// Main handler for a new data point
function handleNewReading(reading) {
  lastReadingTime = new Date(reading.timestamp);
  
  // 1. Update numerical values
  animateNumberValue(elements.fuelValue, reading.fuel);
  animateNumberValue(elements.corrosionValue, reading.corrosion);
  animateNumberValue(elements.tempValue, reading.temp.toFixed(1));
  animateNumberValue(elements.humidityValue, reading.humidity.toFixed(1));
  
  // 2. Animate Circular Gauges
  updateCircularGauge(elements.fuelGaugeFill, reading.fuel);
  updateCircularGauge(elements.corrosionGaugeFill, reading.corrosion);

  // 3. Update Progress Bars
  updateProgressBar(elements.tempRangeFill, (reading.temp / 50) * 100); // 0-50 C range
  updateProgressBar(elements.humidityRangeFill, reading.humidity); // 0-100% range

  // 4. Determine Thresholds and Status Labels
  const fuelStatus = getFuelStatus(reading.fuel);
  const corrosionStatus = getCorrosionStatus(reading.corrosion);
  const humidityRisk = getHumidityRisk(reading.humidity);
  
  updateStatusLabel(elements.fuelStatus, fuelStatus.label, fuelStatus.colorClass);
  updateStatusLabel(elements.corrosionStatus, corrosionStatus.label, corrosionStatus.colorClass);
  
  // 5. Alert Banner Control
  updateAlerts(reading.fuel, reading.corrosion);
  
  // 6. Update Summary Table
  elements.summaryFuel.innerHTML = `${reading.fuel}% <span class="badge label-${fuelStatus.colorClass}">${fuelStatus.label}</span>`;
  elements.summaryCorrosion.innerHTML = `${reading.corrosion}% <span class="badge label-${corrosionStatus.colorClass}">${corrosionStatus.label}</span>`;
  elements.summaryTemp.textContent = `${reading.temp.toFixed(1)} °C`;
  
  let riskColorClass = 'green';
  if (humidityRisk === 'Medium') riskColorClass = 'orange';
  if (humidityRisk === 'High') riskColorClass = 'red';
  elements.summaryHumidityRisk.innerHTML = `${humidityRisk} <span class="badge label-${riskColorClass}">${humidityRisk.toUpperCase()}</span>`;
  
  // Format last reading timestamp
  elements.summaryLastTime.textContent = lastReadingTime.toLocaleTimeString() + ' ' + lastReadingTime.toLocaleDateString();

  // 7. Add Log Entry
  addLogForReading(reading, fuelStatus, corrosionStatus, humidityRisk);

  // 8. Update Chart
  appendChartData(reading);
}

// Helpers for animating number updates
function animateNumberValue(element, targetValue) {
  const startValue = parseFloat(element.textContent) || 0;
  const duration = 400; // ms
  const startTime = performance.now();
  
  function updateNumber(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const currentValue = startValue + (targetValue - startValue) * progress;
    element.textContent = isNaN(currentValue) ? targetValue : (progress === 1 ? targetValue : currentValue.toFixed(element.textContent.includes('.') ? 1 : 0));
    
    if (progress < 1) {
      requestAnimationFrame(updateNumber);
    }
  }
  
  requestAnimationFrame(updateNumber);
}

// Animate Circular SVG gauges
function updateCircularGauge(circleElement, value) {
  const boundedValue = Math.max(0, Math.min(100, value));
  const offset = SVG_CIRCUMFERENCE - (boundedValue / 100) * SVG_CIRCUMFERENCE;
  circleElement.style.strokeDashoffset = offset;
}

// Animate horizontal progress bars
function updateProgressBar(barElement, percentage) {
  const boundedPct = Math.max(0, Math.min(100, percentage));
  barElement.style.width = `${boundedPct}%`;
}

// Set badge labels and color tags
function updateStatusLabel(element, text, colorClass) {
  element.textContent = text;
  element.className = `status-label label-${colorClass}`;
}

// Threshold Rules
function getFuelStatus(fuel) {
  if (fuel < 20) return { label: 'EMPTY', colorClass: 'red' };
  if (fuel <= 50) return { label: 'LOW', colorClass: 'orange' };
  if (fuel <= 80) return { label: 'OK', colorClass: 'green' };
  return { label: 'FULL', colorClass: 'green' };
}

function getCorrosionStatus(corrosion) {
  if (corrosion < 30) return { label: 'MINIMAL', colorClass: 'green' };
  if (corrosion <= 70) return { label: 'MODERATE', colorClass: 'orange' };
  return { label: 'SEVERE', colorClass: 'red' };
}

function getHumidityRisk(humidity) {
  if (humidity < 40) return 'Low';
  if (humidity <= 70) return 'Medium';
  return 'High';
}

// Show/Hide Warning Alerts
function updateAlerts(fuel, corrosion) {
  let messages = [];
  if (fuel < 20) {
    messages.push(`Fuel critically low (${fuel}%)`);
  }
  if (corrosion > 70) {
    messages.push(`Severe corrosion risk detected (${corrosion}%)`);
  }
  
  if (messages.length > 0) {
    elements.alertMessage.textContent = `WARNING: ${messages.join(' | ')}`;
    elements.alertBanner.style.display = 'flex';
  } else {
    elements.alertBanner.style.display = 'none';
  }
}

// ----------------------------------------------------
// Event Logging
// ----------------------------------------------------
let loggedStates = {
  fuelState: null,
  corrosionState: null,
  humidityRisk: null
};

// Generates intelligent, non-redundant log messages
function addLogForReading(reading, fuelStatus, corrosionStatus, humidityRisk) {
  const timestamp = reading.timestamp;
  
  // Initial fill or change detection
  if (loggedStates.fuelState === null) {
    // Log the initial state
    addLogEntry(timestamp, `System Initialized. Fuel level is ${reading.fuel}% (${fuelStatus.label}).`, fuelStatus.colorClass === 'red' ? 'critical' : (fuelStatus.colorClass === 'orange' ? 'warning' : 'normal'));
    addLogEntry(timestamp, `Corrosion accumulation is ${reading.corrosion}% (${corrosionStatus.label}).`, corrosionStatus.colorClass === 'red' ? 'critical' : (corrosionStatus.colorClass === 'orange' ? 'warning' : 'normal'));
    loggedStates.fuelState = fuelStatus.label;
    loggedStates.corrosionState = corrosionStatus.label;
    loggedStates.humidityRisk = humidityRisk;
    return;
  }
  
  // Fuel Level state transition
  if (loggedStates.fuelState !== fuelStatus.label) {
    const msg = `Fuel state transitioned from ${loggedStates.fuelState} to ${fuelStatus.label} (${reading.fuel}%).`;
    const severity = fuelStatus.colorClass === 'red' ? 'critical' : (fuelStatus.colorClass === 'orange' ? 'warning' : 'normal');
    addLogEntry(timestamp, msg, severity);
    loggedStates.fuelState = fuelStatus.label;
  } else if (fuelStatus.label === 'EMPTY' && Math.random() < 0.05) {
    // Occasional reminder if critically low
    addLogEntry(timestamp, `CRITICAL: Fuel remains critically empty (${reading.fuel}%). Fill immediately.`, 'critical');
  }
  
  // Corrosion state transition
  if (loggedStates.corrosionState !== corrosionStatus.label) {
    const msg = `Corrosion accumulation warning transitioned to ${corrosionStatus.label} (${reading.corrosion}%).`;
    const severity = corrosionStatus.colorClass === 'red' ? 'critical' : (corrosionStatus.colorClass === 'orange' ? 'warning' : 'normal');
    addLogEntry(timestamp, msg, severity);
    loggedStates.corrosionState = corrosionStatus.label;
  }
  
  // Humidity risk change
  if (loggedStates.humidityRisk !== humidityRisk) {
    const severity = humidityRisk === 'High' ? 'warning' : 'normal';
    addLogEntry(timestamp, `Atmospheric humidity risk changed to ${humidityRisk.toUpperCase()} (${reading.humidity.toFixed(1)}%).`, severity);
    loggedStates.humidityRisk = humidityRisk;
  }
}

function addLogEntry(timestamp, message, severity) {
  const container = elements.eventLogContainer;
  
  // Clear empty placeholder
  if (container.querySelector('.log-item') && container.innerText.includes('No logs recorded yet.')) {
    container.innerHTML = '';
  }
  
  const timeStr = new Date(timestamp).toLocaleTimeString();
  const logItem = document.createElement('div');
  logItem.className = `log-item severity-${severity}`;
  
  logItem.innerHTML = `
    <div class="log-status-bar"></div>
    <div class="log-content">
      <div class="log-meta">
        <span class="log-time">${timeStr}</span>
      </div>
      <div class="log-msg">${message}</div>
    </div>
  `;
  
  // Prepend so newest is at the top
  container.insertBefore(logItem, container.firstChild);
  
  // Cap entries at 20
  while (container.children.length > 20) {
    container.removeChild(container.lastChild);
  }
}

// ----------------------------------------------------
// Chart.js Setup and Updates
// ----------------------------------------------------
function initChart() {
  const canvasElement = document.getElementById('historyChart');
  if (!canvasElement) return;

  if (typeof Chart === 'undefined') {
    console.warn('Chart.js library not loaded. Trending chart will not be available.');
    const chartPanel = document.querySelector('.chart-panel');
    if (chartPanel) {
      chartPanel.style.display = 'none';
    }
    return;
  }
  
  const ctx = canvasElement.getContext('2d');
  
  const gradientFuel = ctx.createLinearGradient(0, 0, 0, 250);
  gradientFuel.addColorStop(0, 'rgba(245, 166, 35, 0.2)');
  gradientFuel.addColorStop(1, 'rgba(245, 166, 35, 0.0)');

  const gradientCorrosion = ctx.createLinearGradient(0, 0, 0, 250);
  gradientCorrosion.addColorStop(0, 'rgba(160, 81, 255, 0.2)');
  gradientCorrosion.addColorStop(1, 'rgba(160, 81, 255, 0.0)');

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Fuel Level (%)',
          data: [],
          borderColor: '#f5a623',
          backgroundColor: gradientFuel,
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 1,
          pointHoverRadius: 4,
          yAxisID: 'y'
        },
        {
          label: 'Corrosion (%)',
          data: [],
          borderColor: '#a051ff',
          backgroundColor: gradientCorrosion,
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 1,
          pointHoverRadius: 4,
          yAxisID: 'y'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.04)'
          },
          ticks: {
            color: '#8e9cae',
            font: {
              family: 'JetBrains Mono',
              size: 10
            },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8
          }
        },
        y: {
          min: 0,
          max: 100,
          grid: {
            color: 'rgba(255, 255, 255, 0.04)'
          },
          ticks: {
            color: '#8e9cae',
            font: {
              family: 'Inter',
              size: 11
            }
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#f1f5f9',
            font: {
              family: 'Outfit',
              size: 12,
              weight: '500'
            },
            boxWidth: 15,
            padding: 15
          }
        },
        tooltip: {
          backgroundColor: '#131b2c',
          titleColor: '#f1f5f9',
          bodyColor: '#8e9cae',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          titleFont: { family: 'Outfit' },
          bodyFont: { family: 'Inter' }
        }
      }
    }
  });
}

function loadHistory() {
  fetch('/api/history?limit=50')
    .then(res => res.json())
    .then(data => {
      if (!Array.isArray(data) || data.length === 0) return;
      
      // Populate latest reading time so connectivity displays right away
      const lastVal = data[data.length - 1];
      lastReadingTime = new Date(lastVal.timestamp);
      
      // Populate logs and Chart.js if available
      if (chartInstance) {
        const labels = [];
        const fuelData = [];
        const corrosionData = [];
        
        data.forEach(item => {
          const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          labels.push(timeStr);
          fuelData.push(item.fuel);
          corrosionData.push(item.corrosion);
          
          const fuelStatus = getFuelStatus(item.fuel);
          const corrosionStatus = getCorrosionStatus(item.corrosion);
          const humidityRisk = getHumidityRisk(item.humidity);
          addLogForReading(item, fuelStatus, corrosionStatus, humidityRisk);
        });
        
        chartInstance.data.labels = labels;
        chartInstance.data.datasets[0].data = fuelData;
        chartInstance.data.datasets[1].data = corrosionData;
        chartInstance.update();
      } else {
        data.forEach(item => {
          const fuelStatus = getFuelStatus(item.fuel);
          const corrosionStatus = getCorrosionStatus(item.corrosion);
          const humidityRisk = getHumidityRisk(item.humidity);
          addLogForReading(item, fuelStatus, corrosionStatus, humidityRisk);
        });
      }
      
      // Update UI with the final values
      handleNewReading(lastVal);
    })
    .catch(err => console.error('Failed to load history:', err));
}

function appendChartData(reading) {
  if (!chartInstance) return;
  
  const labels = chartInstance.data.labels;
  const fuelData = chartInstance.data.datasets[0].data;
  const corrosionData = chartInstance.data.datasets[1].data;
  
  const timeStr = new Date(reading.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  
  // Add new element
  labels.push(timeStr);
  fuelData.push(reading.fuel);
  corrosionData.push(reading.corrosion);
  
  // Cap at 50 points
  if (labels.length > 50) {
    labels.shift();
    fuelData.shift();
    corrosionData.shift();
  }
  
  chartInstance.update();
}
