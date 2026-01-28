/**
 * Inertia - IMU Sensor Diagnostics
 * 
 * This tool captures the highest quality sensor data available through
 * web APIs and provides detailed diagnostics for research purposes.
 */

(function() {
  'use strict';

  // ============================================
  // State
  // ============================================
  
  const state = {
    permissionGranted: false,
    isRecording: false,
    isMeasuringNoise: false,
    
    // Timing analysis
    lastTimestamp: null,
    intervals: [],
    maxIntervalsStored: 100,
    droppedSamples: 0,
    expectedInterval: 16.67, // ~60Hz
    
    // Sample counting
    sampleCount: 0,
    startTime: null,
    
    // Recording buffer
    recordedData: [],
    
    // Noise measurement
    noiseAccelSamples: [],
    noiseGyroSamples: [],
    
    // Latest values (for noise measurement)
    lastAccel: { x: 0, y: 0, z: 0 },
    lastGyro: { alpha: 0, beta: 0, gamma: 0 },
    
    // Latency measurement
    latencyTapTime: null,
    latencyWaiting: false,
    latencyBaseline: null,
    latencyMeasurements: [],
    latencyThreshold: 2.0 // m/s² above baseline to detect tap impact
  };

  // ============================================
  // DOM Elements
  // ============================================
  
  const elements = {
    // Permission
    permissionGate: document.getElementById('permission-gate'),
    requestPermission: document.getElementById('request-permission'),
    permissionStatus: document.getElementById('permission-status'),
    dashboard: document.getElementById('dashboard'),
    
    // Status
    sensorStatus: document.getElementById('sensor-status'),
    sampleRate: document.getElementById('sample-rate'),
    sampleCount: document.getElementById('sample-count'),
    droppedCount: document.getElementById('dropped-count'),
    
    // Accelerometer
    accelX: document.getElementById('accel-x'),
    accelY: document.getElementById('accel-y'),
    accelZ: document.getElementById('accel-z'),
    accelMag: document.getElementById('accel-mag'),
    
    // Gyroscope
    gyroAlpha: document.getElementById('gyro-alpha'),
    gyroBeta: document.getElementById('gyro-beta'),
    gyroGamma: document.getElementById('gyro-gamma'),
    gyroMag: document.getElementById('gyro-mag'),
    
    // Timing
    intervalReported: document.getElementById('interval-reported'),
    intervalMeasured: document.getElementById('interval-measured'),
    intervalJitter: document.getElementById('interval-jitter'),
    intervalMinMax: document.getElementById('interval-minmax'),
    
    // Noise
    measureNoise: document.getElementById('measure-noise'),
    noiseResults: document.getElementById('noise-results'),
    accelNoise: document.getElementById('accel-noise'),
    gyroNoise: document.getElementById('gyro-noise'),
    
    // Recording
    startRecording: document.getElementById('start-recording'),
    stopRecording: document.getElementById('stop-recording'),
    exportCsv: document.getElementById('export-csv'),
    exportJson: document.getElementById('export-json'),
    recordingStatus: document.getElementById('recording-status'),
    recordingCount: document.getElementById('recording-count'),
    
    // API Info
    apiDeviceMotion: document.getElementById('api-devicemotion'),
    apiDeviceOrientation: document.getElementById('api-deviceorientation'),
    apiGenericSensor: document.getElementById('api-genericsensor'),
    apiUserAgent: document.getElementById('api-useragent'),
    
    // Latency
    latencyTarget: document.getElementById('latency-target'),
    latencyTargetText: null, // Will be set after DOM query
    latencyTargetSub: null,
    latencyStatus: document.getElementById('latency-status'),
    latencyResults: document.getElementById('latency-results'),
    latencyLast: document.getElementById('latency-last'),
    latencyAvg: document.getElementById('latency-avg'),
    latencyMin: document.getElementById('latency-min'),
    latencyMax: document.getElementById('latency-max'),
    latencyTapCount: document.getElementById('latency-tap-count'),
    resetLatency: document.getElementById('reset-latency')
  };
  
  // Set child elements after main element exists
  elements.latencyTargetText = elements.latencyTarget.querySelector('.latency-target-text');
  elements.latencyTargetSub = elements.latencyTarget.querySelector('.latency-target-sub');

  // ============================================
  // Initialization
  // ============================================
  
  function init() {
    detectAPISupport();
    setupEventListeners();
    checkExistingPermission();
  }

  function detectAPISupport() {
    // DeviceMotionEvent
    const hasDeviceMotion = 'DeviceMotionEvent' in window;
    elements.apiDeviceMotion.textContent = hasDeviceMotion ? 'Supported' : 'Not Supported';
    elements.apiDeviceMotion.classList.add(hasDeviceMotion ? 'supported' : 'not-supported');
    
    // DeviceOrientationEvent
    const hasDeviceOrientation = 'DeviceOrientationEvent' in window;
    elements.apiDeviceOrientation.textContent = hasDeviceOrientation ? 'Supported' : 'Not Supported';
    elements.apiDeviceOrientation.classList.add(hasDeviceOrientation ? 'supported' : 'not-supported');
    
    // Generic Sensor API (Accelerometer, Gyroscope)
    const hasGenericSensor = 'Accelerometer' in window && 'Gyroscope' in window;
    elements.apiGenericSensor.textContent = hasGenericSensor ? 'Supported' : 'Not Supported';
    elements.apiGenericSensor.classList.add(hasGenericSensor ? 'supported' : 'not-supported');
    
    // User Agent
    elements.apiUserAgent.textContent = navigator.userAgent;
  }

  function checkExistingPermission() {
    // On non-iOS devices or older iOS, permission might not be required
    if (typeof DeviceMotionEvent.requestPermission !== 'function') {
      // Permission not required, start directly
      startSensors();
      return;
    }
    
    // iOS 13+ requires permission - show the gate
    elements.permissionGate.classList.remove('hidden');
  }

  function setupEventListeners() {
    elements.requestPermission.addEventListener('click', requestPermission);
    elements.measureNoise.addEventListener('click', measureNoise);
    elements.startRecording.addEventListener('click', startRecording);
    elements.stopRecording.addEventListener('click', stopRecording);
    elements.exportCsv.addEventListener('click', () => exportData('csv'));
    elements.exportJson.addEventListener('click', () => exportData('json'));
    
    // Latency test - use touchstart for lowest latency on mobile
    elements.latencyTarget.addEventListener('touchstart', handleLatencyTap, { passive: true });
    elements.latencyTarget.addEventListener('mousedown', handleLatencyTap);
    elements.resetLatency.addEventListener('click', resetLatencyTest);
  }

  // ============================================
  // Permission Handling
  // ============================================
  
  async function requestPermission() {
    try {
      elements.permissionStatus.textContent = 'Requesting permission...';
      elements.permissionStatus.className = 'status';
      
      const permission = await DeviceMotionEvent.requestPermission();
      
      if (permission === 'granted') {
        elements.permissionStatus.textContent = 'Permission granted!';
        elements.permissionStatus.classList.add('success');
        state.permissionGranted = true;
        
        setTimeout(() => {
          startSensors();
        }, 500);
      } else {
        elements.permissionStatus.textContent = 'Permission denied. Please enable in Settings.';
        elements.permissionStatus.classList.add('error');
      }
    } catch (error) {
      elements.permissionStatus.textContent = `Error: ${error.message}`;
      elements.permissionStatus.classList.add('error');
      console.error('Permission error:', error);
    }
  }

  // ============================================
  // Sensor Data Collection
  // ============================================
  
  function startSensors() {
    elements.permissionGate.classList.add('hidden');
    elements.dashboard.classList.remove('hidden');
    
    // Try Generic Sensor API first (Android/Chrome)
    if ('Accelerometer' in window && 'Gyroscope' in window) {
      tryGenericSensorAPI();
    } else {
      // Fall back to DeviceMotionEvent (iOS/Safari)
      useDeviceMotionAPI();
    }
  }

  function tryGenericSensorAPI() {
    try {
      // Request highest possible frequency
      const options = { frequency: 100 }; // 100 Hz
      
      const accelerometer = new Accelerometer(options);
      const gyroscope = new Gyroscope(options);
      
      let lastTime = performance.now();
      
      accelerometer.addEventListener('reading', () => {
        const now = performance.now();
        const interval = now - lastTime;
        lastTime = now;
        
        handleSensorData({
          acceleration: {
            x: accelerometer.x,
            y: accelerometer.y,
            z: accelerometer.z
          },
          rotationRate: {
            alpha: gyroscope.x, // Generic Sensor uses x/y/z
            beta: gyroscope.y,
            gamma: gyroscope.z
          },
          interval: interval,
          timestamp: now,
          source: 'GenericSensor'
        });
      });
      
      accelerometer.addEventListener('error', (e) => {
        console.warn('Accelerometer error, falling back:', e.error);
        useDeviceMotionAPI();
      });
      
      accelerometer.start();
      gyroscope.start();
      
      elements.sensorStatus.textContent = 'Generic Sensor API';
      elements.sensorStatus.style.color = 'var(--accent-success)';
      
    } catch (error) {
      console.warn('Generic Sensor API failed, falling back:', error);
      useDeviceMotionAPI();
    }
  }

  function useDeviceMotionAPI() {
    // Use passive: true to hint browser this won't block scrolling
    window.addEventListener('devicemotion', handleDeviceMotion, { passive: true, capture: false });
    
    elements.sensorStatus.textContent = 'DeviceMotion API';
    elements.sensorStatus.style.color = 'var(--accent-warning)';
    state.startTime = performance.now();
  }

  function handleDeviceMotion(event) {
    const now = performance.now();
    
    // Calculate measured interval
    let measuredInterval = 0;
    if (state.lastTimestamp !== null) {
      measuredInterval = now - state.lastTimestamp;
      state.intervals.push(measuredInterval);
      if (state.intervals.length > state.maxIntervalsStored) {
        state.intervals.shift();
      }
      
      // Detect dropped samples (if interval > 1.5x expected, we likely dropped frames)
      if (measuredInterval > state.expectedInterval * 1.5) {
        const dropped = Math.round(measuredInterval / state.expectedInterval) - 1;
        state.droppedSamples += dropped;
      }
    }
    state.lastTimestamp = now;
    
    handleSensorData({
      // Use accelerationIncludingGravity for most raw data
      acceleration: event.accelerationIncludingGravity || event.acceleration,
      // Also capture without gravity for comparison
      accelerationNoGravity: event.acceleration,
      rotationRate: event.rotationRate,
      interval: event.interval, // Reported by API
      measuredInterval: measuredInterval,
      timestamp: now,
      source: 'DeviceMotion'
    });
  }

  function handleSensorData(data) {
    state.sampleCount++;
    
    // Update display
    updateAccelerometerDisplay(data.acceleration);
    updateGyroscopeDisplay(data.rotationRate);
    updateTimingDisplay(data);
    updateStatusDisplay();
    
    // Store for noise measurement
    if (data.acceleration) {
      state.lastAccel = {
        x: data.acceleration.x || 0,
        y: data.acceleration.y || 0,
        z: data.acceleration.z || 0
      };
    }
    if (data.rotationRate) {
      state.lastGyro = {
        alpha: data.rotationRate.alpha || 0,
        beta: data.rotationRate.beta || 0,
        gamma: data.rotationRate.gamma || 0
      };
    }
    
    // Noise measurement
    if (state.isMeasuringNoise) {
      state.noiseAccelSamples.push({ ...state.lastAccel });
      state.noiseGyroSamples.push({ ...state.lastGyro });
    }
    
    // Recording
    if (state.isRecording) {
      state.recordedData.push({
        timestamp: data.timestamp,
        interval: data.interval,
        measuredInterval: data.measuredInterval,
        accel: { ...state.lastAccel },
        accelNoGravity: data.accelerationNoGravity ? {
          x: data.accelerationNoGravity.x || 0,
          y: data.accelerationNoGravity.y || 0,
          z: data.accelerationNoGravity.z || 0
        } : null,
        gyro: { ...state.lastGyro }
      });
      elements.recordingCount.textContent = state.recordedData.length;
    }
    
    // Latency detection
    checkLatencySpike(data);
  }

  // ============================================
  // Display Updates
  // ============================================
  
  function formatValue(val, decimals = 4) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    return val.toFixed(decimals);
  }

  function updateAccelerometerDisplay(accel) {
    if (!accel) return;
    
    const x = accel.x || 0;
    const y = accel.y || 0;
    const z = accel.z || 0;
    
    elements.accelX.textContent = formatValue(x);
    elements.accelY.textContent = formatValue(y);
    elements.accelZ.textContent = formatValue(z);
    
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    elements.accelMag.textContent = formatValue(magnitude, 3);
  }

  function updateGyroscopeDisplay(gyro) {
    if (!gyro) return;
    
    const alpha = gyro.alpha || 0;
    const beta = gyro.beta || 0;
    const gamma = gyro.gamma || 0;
    
    elements.gyroAlpha.textContent = formatValue(alpha);
    elements.gyroBeta.textContent = formatValue(beta);
    elements.gyroGamma.textContent = formatValue(gamma);
    
    const magnitude = Math.sqrt(alpha * alpha + beta * beta + gamma * gamma);
    elements.gyroMag.textContent = formatValue(magnitude, 3);
  }

  function updateTimingDisplay(data) {
    // Reported interval
    if (data.interval !== undefined) {
      elements.intervalReported.textContent = formatValue(data.interval, 2) + ' ms';
    }
    
    // Measured interval
    if (data.measuredInterval) {
      elements.intervalMeasured.textContent = formatValue(data.measuredInterval, 2) + ' ms';
    }
    
    // Jitter (standard deviation)
    if (state.intervals.length > 10) {
      const stats = calculateStats(state.intervals);
      elements.intervalJitter.textContent = formatValue(stats.stdDev, 2) + ' ms';
      elements.intervalMinMax.textContent = `${formatValue(stats.min, 1)} / ${formatValue(stats.max, 1)} ms`;
    }
  }

  function updateStatusDisplay() {
    elements.sampleCount.textContent = state.sampleCount.toLocaleString();
    elements.droppedCount.textContent = state.droppedSamples.toLocaleString();
    
    // Calculate actual sample rate
    if (state.startTime && state.sampleCount > 10) {
      const elapsed = (performance.now() - state.startTime) / 1000;
      const rate = state.sampleCount / elapsed;
      elements.sampleRate.textContent = formatValue(rate, 1) + ' Hz';
    }
  }

  // ============================================
  // Latency Measurement
  // ============================================
  
  function handleLatencyTap(event) {
    // Prevent double-firing from both touch and mouse events
    if (event.type === 'mousedown' && 'ontouchstart' in window) {
      return;
    }
    
    if (state.latencyWaiting) return;
    
    // Record tap time with highest precision available
    state.latencyTapTime = performance.now();
    state.latencyWaiting = true;
    
    // Store current acceleration as baseline
    const mag = Math.sqrt(
      state.lastAccel.x ** 2 + 
      state.lastAccel.y ** 2 + 
      state.lastAccel.z ** 2
    );
    state.latencyBaseline = mag;
    
    // Visual feedback
    elements.latencyTarget.classList.add('waiting');
    elements.latencyTargetText.textContent = 'WAITING...';
    elements.latencyTargetSub.textContent = 'Detecting impact...';
    elements.latencyStatus.textContent = '👆 Tap detected! Waiting for accelerometer spike...';
    elements.latencyStatus.className = 'latency-status waiting';
    
    // Timeout if no spike detected
    setTimeout(() => {
      if (state.latencyWaiting) {
        state.latencyWaiting = false;
        elements.latencyTarget.classList.remove('waiting');
        elements.latencyTargetText.textContent = 'TAP HERE';
        elements.latencyTargetSub.textContent = 'Hold phone, tap firmly';
        elements.latencyStatus.textContent = '❌ No impact detected. Try tapping harder or hold phone in hand.';
        elements.latencyStatus.className = 'latency-status timeout';
      }
    }, 500);
  }
  
  function checkLatencySpike(data) {
    if (!state.latencyWaiting || !data.acceleration) return;
    
    const mag = Math.sqrt(
      (data.acceleration.x || 0) ** 2 + 
      (data.acceleration.y || 0) ** 2 + 
      (data.acceleration.z || 0) ** 2
    );
    
    // Check if we have a significant spike above baseline
    const delta = Math.abs(mag - (state.latencyBaseline || 9.8));
    
    if (delta > state.latencyThreshold) {
      const latency = data.timestamp - state.latencyTapTime;
      
      // Sanity check - latency should be positive and reasonable
      if (latency > 0 && latency < 500) {
        state.latencyMeasurements.push(latency);
        updateLatencyDisplay(latency);
        
        // Visual feedback - success
        elements.latencyTarget.classList.remove('waiting');
        elements.latencyTarget.classList.add('detected');
        elements.latencyTargetText.textContent = `${latency.toFixed(1)} ms`;
        elements.latencyTargetSub.textContent = 'Impact detected!';
        elements.latencyStatus.textContent = `✅ Success! Latency: ${latency.toFixed(1)} ms (spike: ${delta.toFixed(2)} m/s²)`;
        elements.latencyStatus.className = 'latency-status success';
        
        setTimeout(() => {
          elements.latencyTarget.classList.remove('detected');
          elements.latencyTargetText.textContent = 'TAP HERE';
          elements.latencyTargetSub.textContent = 'Hold phone, tap firmly';
        }, 1000);
      }
      
      state.latencyWaiting = false;
    }
  }
  
  function updateLatencyDisplay(lastLatency) {
    const measurements = state.latencyMeasurements;
    
    elements.latencyResults.classList.remove('hidden');
    elements.latencyLast.textContent = lastLatency.toFixed(1) + ' ms';
    elements.latencyTapCount.textContent = measurements.length;
    
    if (measurements.length > 0) {
      const stats = calculateStats(measurements);
      elements.latencyAvg.textContent = stats.mean.toFixed(1) + ' ms';
      elements.latencyMin.textContent = stats.min.toFixed(1) + ' ms';
      elements.latencyMax.textContent = stats.max.toFixed(1) + ' ms';
    }
  }
  
  function resetLatencyTest() {
    state.latencyMeasurements = [];
    state.latencyWaiting = false;
    state.latencyTapTime = null;
    
    elements.latencyResults.classList.add('hidden');
    elements.latencyTarget.classList.remove('waiting', 'detected');
    elements.latencyTargetText.textContent = 'TAP HERE';
    elements.latencyTargetSub.textContent = 'Hold phone, tap firmly';
    elements.latencyStatus.textContent = '';
    elements.latencyStatus.className = 'latency-status';
  }

  // ============================================
  // Noise Measurement
  // ============================================
  
  function measureNoise() {
    if (state.isMeasuringNoise) return;
    
    state.isMeasuringNoise = true;
    state.noiseAccelSamples = [];
    state.noiseGyroSamples = [];
    
    elements.measureNoise.textContent = 'Measuring...';
    elements.measureNoise.disabled = true;
    
    setTimeout(() => {
      state.isMeasuringNoise = false;
      elements.measureNoise.textContent = 'Measure Noise (3s)';
      elements.measureNoise.disabled = false;
      
      calculateNoiseResults();
    }, 3000);
  }

  function calculateNoiseResults() {
    if (state.noiseAccelSamples.length < 10) {
      alert('Not enough samples collected. Make sure sensors are active.');
      return;
    }
    
    // Calculate accelerometer noise (standard deviation of magnitude)
    const accelMagnitudes = state.noiseAccelSamples.map(s => 
      Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z)
    );
    const accelStats = calculateStats(accelMagnitudes);
    
    // Calculate gyroscope noise
    const gyroMagnitudes = state.noiseGyroSamples.map(s => 
      Math.sqrt(s.alpha * s.alpha + s.beta * s.beta + s.gamma * s.gamma)
    );
    const gyroStats = calculateStats(gyroMagnitudes);
    
    elements.accelNoise.textContent = formatValue(accelStats.stdDev, 4) + ' m/s²';
    elements.gyroNoise.textContent = formatValue(gyroStats.stdDev, 4) + ' rad/s';
    elements.noiseResults.classList.remove('hidden');
  }

  // ============================================
  // Recording
  // ============================================
  
  function startRecording() {
    state.isRecording = true;
    state.recordedData = [];
    
    // Lock scrolling to prevent sample drops
    document.body.classList.add('recording-active');
    
    // Try to lock screen orientation
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('portrait').catch(() => {
        // Orientation lock not supported or denied - that's fine
      });
    }
    
    elements.startRecording.classList.add('hidden');
    elements.stopRecording.classList.remove('hidden');
    elements.exportCsv.classList.add('hidden');
    elements.exportJson.classList.add('hidden');
    elements.recordingStatus.classList.remove('hidden');
    elements.recordingCount.textContent = '0';
  }

  function stopRecording() {
    state.isRecording = false;
    
    // Unlock scrolling
    document.body.classList.remove('recording-active');
    
    // Unlock screen orientation
    if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
    }
    
    elements.startRecording.classList.remove('hidden');
    elements.stopRecording.classList.add('hidden');
    elements.recordingStatus.classList.add('hidden');
    
    if (state.recordedData.length > 0) {
      elements.exportCsv.classList.remove('hidden');
      elements.exportJson.classList.remove('hidden');
    }
  }

  function exportData(format) {
    if (state.recordedData.length === 0) {
      alert('No data to export');
      return;
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    if (format === 'csv') {
      exportCSV(timestamp);
    } else {
      exportJSON(timestamp);
    }
  }

  function exportCSV(timestamp) {
    const headers = [
      'timestamp_ms',
      'interval_reported_ms',
      'interval_measured_ms',
      'accel_x',
      'accel_y',
      'accel_z',
      'accel_no_gravity_x',
      'accel_no_gravity_y',
      'accel_no_gravity_z',
      'gyro_alpha',
      'gyro_beta',
      'gyro_gamma'
    ];
    
    const rows = state.recordedData.map(d => [
      d.timestamp,
      d.interval || '',
      d.measuredInterval || '',
      d.accel.x,
      d.accel.y,
      d.accel.z,
      d.accelNoGravity ? d.accelNoGravity.x : '',
      d.accelNoGravity ? d.accelNoGravity.y : '',
      d.accelNoGravity ? d.accelNoGravity.z : '',
      d.gyro.alpha,
      d.gyro.beta,
      d.gyro.gamma
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadFile(csv, `inertia-${timestamp}.csv`, 'text/csv');
  }

  function exportJSON(timestamp) {
    const data = {
      metadata: {
        exportTime: new Date().toISOString(),
        sampleCount: state.recordedData.length,
        userAgent: navigator.userAgent,
        source: elements.sensorStatus.textContent
      },
      samples: state.recordedData
    };
    
    const json = JSON.stringify(data, null, 2);
    downloadFile(json, `inertia-${timestamp}.json`, 'application/json');
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ============================================
  // Utilities
  // ============================================
  
  function calculateStats(arr) {
    const n = arr.length;
    if (n === 0) return { mean: 0, stdDev: 0, min: 0, max: 0 };
    
    const mean = arr.reduce((a, b) => a + b, 0) / n;
    const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    
    return { mean, stdDev, min, max };
  }

  // ============================================
  // Start
  // ============================================
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

