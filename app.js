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
    latencyThreshold: 2.0, // m/s² above baseline to detect tap impact
    
    // Audio
    audioContext: null,
    audioEnabled: true,
    
    // Position integration
    integrationActive: true,
    velocity: { x: 0, y: 0, z: 0 },
    position: { x: 0, y: 0, z: 0 },
    lastIntegrationTime: null,
    gravityEstimate: { x: 0, y: 0, z: 9.81 }, // Will be calibrated
    
    // Position history for graphs
    heightHistory: [],
    xyHistory: [],
    maxHistoryLength: 200
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
    resetLatency: document.getElementById('reset-latency'),
    
    // Position integration
    resetIntegration: document.getElementById('reset-integration'),
    integrationActive: document.getElementById('integration-active'),
    posX: document.getElementById('pos-x'),
    posY: document.getElementById('pos-y'),
    posZ: document.getElementById('pos-z'),
    heightGraph: document.getElementById('height-graph'),
    xyGraph: document.getElementById('xy-graph')
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
    
    // Test sound button
    document.getElementById('test-sound').addEventListener('click', () => {
      initAudio();
      playClick();
      console.log('Test sound triggered');
    });
    
    // Screen lock controls
    document.getElementById('lock-portrait').addEventListener('click', lockPortrait);
    document.getElementById('exit-fullscreen').addEventListener('click', exitFullscreen);
    
    // Position integration controls
    elements.resetIntegration.addEventListener('click', resetIntegration);
    elements.integrationActive.addEventListener('change', (e) => {
      state.integrationActive = e.target.checked;
    });
    
    // Listen for fullscreen changes
    document.addEventListener('fullscreenchange', updateFullscreenUI);
    document.addEventListener('webkitfullscreenchange', updateFullscreenUI);
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
    
    // Position integration
    if (state.integrationActive) {
      integratePosition(data);
    }
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
  // Screen Orientation Lock
  // ============================================
  
  async function lockPortrait() {
    const statusEl = document.getElementById('lock-status');
    
    try {
      // First, try to go fullscreen (required for orientation lock on most browsers)
      const docEl = document.documentElement;
      
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      } else if (docEl.webkitRequestFullscreen) {
        await docEl.webkitRequestFullscreen();
      }
      
      // Now try to lock orientation
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('portrait-primary');
        statusEl.textContent = '✅ Portrait locked! Orientation will stay fixed.';
        statusEl.style.color = 'var(--accent-success)';
      } else {
        // iOS doesn't support orientation lock API, but fullscreen helps
        statusEl.textContent = '⚠️ Fullscreen active. iOS cannot lock orientation via web API - use device rotation lock in Control Center.';
        statusEl.style.color = 'var(--accent-warning)';
      }
      
      updateFullscreenUI();
      
    } catch (error) {
      console.error('Lock failed:', error);
      statusEl.textContent = `⚠️ ${error.message}. On iOS, use Control Center rotation lock.`;
      statusEl.style.color = 'var(--accent-warning)';
    }
  }
  
  function exitFullscreen() {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
    
    // Unlock orientation
    if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
    }
    
    const statusEl = document.getElementById('lock-status');
    statusEl.textContent = '';
  }
  
  function updateFullscreenUI() {
    const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    document.getElementById('lock-portrait').classList.toggle('hidden', isFullscreen);
    document.getElementById('exit-fullscreen').classList.toggle('hidden', !isFullscreen);
  }

  // ============================================
  // Audio Feedback
  // ============================================
  
  function initAudio() {
    // Create audio context on first user interaction (required by browsers)
    if (!state.audioContext) {
      try {
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('AudioContext created, state:', state.audioContext.state);
      } catch (e) {
        console.error('Failed to create AudioContext:', e);
        return;
      }
    }
    // Resume if suspended (iOS requires this)
    if (state.audioContext.state === 'suspended') {
      state.audioContext.resume().then(() => {
        console.log('AudioContext resumed');
      });
    }
  }
  
  function playClick() {
    if (!state.audioEnabled) return;
    
    // Make sure audio is initialized
    if (!state.audioContext) {
      initAudio();
    }
    
    if (!state.audioContext) {
      console.error('No AudioContext available');
      return;
    }
    
    // Resume if needed (belt and suspenders)
    if (state.audioContext.state === 'suspended') {
      state.audioContext.resume();
    }
    
    const ctx = state.audioContext;
    const now = ctx.currentTime;
    
    console.log('Playing click at', now, 'context state:', ctx.state);
    
    // Create a louder, longer click sound
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    // Make it more audible - louder and slightly longer
    oscillator.type = 'square'; // Square wave is more audible
    oscillator.frequency.setValueAtTime(1000, now);
    oscillator.frequency.exponentialRampToValueAtTime(300, now + 0.1);
    
    gainNode.gain.setValueAtTime(0.5, now); // Louder
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    
    oscillator.start(now);
    oscillator.stop(now + 0.1);
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
    
    // Initialize audio on first tap (requires user gesture)
    initAudio();
    
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
        
        // Play click sound - this is the sound delayed by sensor latency!
        playClick();
        
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
  // Position Integration
  // ============================================
  
  function resetIntegration() {
    // Reset position and velocity
    state.velocity = { x: 0, y: 0, z: 0 };
    state.position = { x: 0, y: 0, z: 0 };
    state.lastIntegrationTime = null;
    
    // Clear history
    state.heightHistory = [];
    state.xyHistory = [];
    
    // Calibrate gravity using current acceleration reading
    // Assumes phone is stationary when reset is pressed
    state.gravityEstimate = { ...state.lastAccel };
    
    // Update display
    updatePositionDisplay();
    drawHeightGraph();
    drawXYGraph();
    
    console.log('Integration reset. Gravity calibrated to:', state.gravityEstimate);
  }
  
  function integratePosition(data) {
    const now = data.timestamp;
    
    // Need at least two samples to integrate
    if (state.lastIntegrationTime === null) {
      state.lastIntegrationTime = now;
      return;
    }
    
    // Calculate dt in seconds
    const dt = (now - state.lastIntegrationTime) / 1000;
    state.lastIntegrationTime = now;
    
    // Skip if dt is too large (probably a gap in data)
    if (dt > 0.1 || dt <= 0) return;
    
    // Get acceleration and subtract gravity estimate
    const accel = {
      x: (state.lastAccel.x || 0) - state.gravityEstimate.x,
      y: (state.lastAccel.y || 0) - state.gravityEstimate.y,
      z: (state.lastAccel.z || 0) - state.gravityEstimate.z
    };
    
    // Simple Euler integration: v = v + a*dt
    state.velocity.x += accel.x * dt;
    state.velocity.y += accel.y * dt;
    state.velocity.z += accel.z * dt;
    
    // Position: p = p + v*dt
    state.position.x += state.velocity.x * dt;
    state.position.y += state.velocity.y * dt;
    state.position.z += state.velocity.z * dt;
    
    // Store history for graphs
    state.heightHistory.push({
      time: now,
      z: state.position.z
    });
    
    state.xyHistory.push({
      x: state.position.x,
      y: state.position.y
    });
    
    // Limit history length
    if (state.heightHistory.length > state.maxHistoryLength) {
      state.heightHistory.shift();
    }
    if (state.xyHistory.length > state.maxHistoryLength) {
      state.xyHistory.shift();
    }
    
    // Update display (throttle to ~10fps for performance)
    if (state.sampleCount % 6 === 0) {
      updatePositionDisplay();
      drawHeightGraph();
      drawXYGraph();
    }
  }
  
  function updatePositionDisplay() {
    elements.posX.textContent = state.position.x.toFixed(3) + ' m';
    elements.posY.textContent = state.position.y.toFixed(3) + ' m';
    elements.posZ.textContent = state.position.z.toFixed(3) + ' m';
  }
  
  function drawHeightGraph() {
    const canvas = elements.heightGraph;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Fixed scale: -0.5m to +0.5m
    const minZ = -0.5;
    const maxZ = 0.5;
    const range = maxZ - minZ;
    
    // Clear
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, width, height);
    
    const padding = 30; // More padding for labels
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;
    
    // Helper function
    const zToY = (z) => {
      const clamped = Math.max(minZ, Math.min(maxZ, z));
      return padding + graphHeight - ((clamped - minZ) / range) * graphHeight;
    };
    
    // Draw horizontal gridlines at 0.25m intervals
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    [-0.5, -0.25, 0, 0.25, 0.5].forEach(z => {
      const y = zToY(z);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    });
    
    // Draw zero line (bolder)
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, zToY(0));
    ctx.lineTo(width - padding, zToY(0));
    ctx.stroke();
    
    // Draw Y-axis labels
    ctx.fillStyle = '#666';
    ctx.font = '10px SF Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('+0.5m', padding - 5, zToY(0.5) + 3);
    ctx.fillText('+0.25', padding - 5, zToY(0.25) + 3);
    ctx.fillText('0', padding - 5, zToY(0) + 3);
    ctx.fillText('-0.25', padding - 5, zToY(-0.25) + 3);
    ctx.fillText('-0.5m', padding - 5, zToY(-0.5) + 3);
    ctx.textAlign = 'left';
    
    // Draw height line
    if (state.heightHistory.length >= 2) {
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      
      state.heightHistory.forEach((point, i) => {
        const x = padding + (i / (state.heightHistory.length - 1)) * graphWidth;
        const y = zToY(point.z);
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      
      ctx.stroke();
    }
    
    // Draw current value label (top right)
    ctx.fillStyle = '#e8e8f0';
    ctx.font = '12px SF Mono, monospace';
    ctx.textAlign = 'right';
    const currentZ = state.position.z;
    const clampNote = (currentZ > maxZ || currentZ < minZ) ? ' (clipped)' : '';
    ctx.fillText(`Z: ${currentZ.toFixed(3)}m${clampNote}`, width - padding, padding + 15);
    ctx.textAlign = 'left';
  }
  
  function drawXYGraph() {
    const canvas = elements.xyGraph;
    const ctx = canvas.getContext('2d');
    const size = canvas.width; // Assuming square
    
    // Fixed scale: ±0.5 meters
    const maxRange = 0.5;
    
    // Clear
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, size, size);
    
    const padding = 30;
    const graphSize = size - padding * 2;
    
    // Helper to convert position to canvas coords (clamp to range)
    const toCanvasX = (x) => {
      const clamped = Math.max(-maxRange, Math.min(maxRange, x));
      return padding + ((clamped + maxRange) / (maxRange * 2)) * graphSize;
    };
    const toCanvasY = (y) => {
      const clamped = Math.max(-maxRange, Math.min(maxRange, y));
      return padding + graphSize - ((clamped + maxRange) / (maxRange * 2)) * graphSize;
    };
    
    // Draw gridlines at 0.25m intervals
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    [-0.5, -0.25, 0.25, 0.5].forEach(v => {
      // Vertical lines
      ctx.beginPath();
      ctx.moveTo(toCanvasX(v), padding);
      ctx.lineTo(toCanvasX(v), size - padding);
      ctx.stroke();
      // Horizontal lines
      ctx.beginPath();
      ctx.moveTo(padding, toCanvasY(v));
      ctx.lineTo(size - padding, toCanvasY(v));
      ctx.stroke();
    });
    
    // Draw axes (bolder)
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(toCanvasX(0), padding);
    ctx.lineTo(toCanvasX(0), size - padding);
    ctx.moveTo(padding, toCanvasY(0));
    ctx.lineTo(size - padding, toCanvasY(0));
    ctx.stroke();
    
    // Axis labels
    ctx.fillStyle = '#666';
    ctx.font = '10px SF Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('-0.5m', toCanvasX(-0.5), size - padding + 12);
    ctx.fillText('0', toCanvasX(0), size - padding + 12);
    ctx.fillText('+0.5m', toCanvasX(0.5), size - padding + 12);
    ctx.textAlign = 'right';
    ctx.fillText('+0.5m', padding - 5, toCanvasY(0.5) + 3);
    ctx.fillText('0', padding - 5, toCanvasY(0) + 3);
    ctx.fillText('-0.5m', padding - 5, toCanvasY(-0.5) + 3);
    
    // Draw path
    if (state.xyHistory.length >= 2) {
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.beginPath();
      
      state.xyHistory.forEach((point, i) => {
        const x = toCanvasX(point.x);
        const y = toCanvasY(point.y);
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      
      ctx.stroke();
    }
    
    // Draw current position dot
    const currentX = toCanvasX(state.position.x);
    const currentY = toCanvasY(state.position.y);
    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.arc(currentX, currentY, 6, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw origin dot
    ctx.fillStyle = '#666';
    ctx.beginPath();
    ctx.arc(toCanvasX(0), toCanvasY(0), 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Current position labels (top left)
    ctx.fillStyle = '#e8e8f0';
    ctx.font = '12px SF Mono, monospace';
    ctx.textAlign = 'left';
    const xClip = (Math.abs(state.position.x) > maxRange) ? '!' : '';
    const yClip = (Math.abs(state.position.y) > maxRange) ? '!' : '';
    ctx.fillText(`X: ${state.position.x.toFixed(3)}m${xClip}`, padding + 5, padding + 15);
    ctx.fillText(`Y: ${state.position.y.toFixed(3)}m${yClip}`, padding + 5, padding + 30);
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

