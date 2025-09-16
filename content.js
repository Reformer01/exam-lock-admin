// Exam Lock Extension - Content Script
// Monitors page visibility and enforces exam security with fullscreen mode

class ExamLock {
  constructor() {
    this.isLocked = false;
    this.violationCount = 0;
    this.isFullscreenActive = false;
    this.fullscreenAttempts = 0;
    this.maxFullscreenAttempts = 3;
    this.settings = {
      mode: 'overlay', // 'submit', 'overlay', 'timer'
      timerDuration: 30, // seconds
      maxViolations: 3,
      warningMessage: 'Tab switching detected! This action has been logged.',
      lockMessage: 'EXAM SECURITY VIOLATION\nYou have been locked out for switching tabs.',
      timerMessage: 'You must wait {time} seconds before continuing the exam.',
      enableFullscreen: true,
      forceFullscreen: true,
      fullscreenMessage: 'This exam requires fullscreen mode. Please allow fullscreen access.',
      enableLogging: true,
      strictMode: false,
      enableExamTimer: false,
      examDuration: 60, // minutes
      timerWarningTime: 10, // minutes
      timerAction: 'submit' // 'submit', 'lock', 'warn'
    };
    
    // Add this line to track timer if in timer mode
    this.timerInterval = null;
    
    // Timer properties
    this.examTimer = null;
    this.timeRemaining = 0;
    this.timerWarningShown = false;
    this.isOffline = false;
    this.timerWasRunningBeforeOffline = false;
    // Temporary lock timer ("timer" mode) state
    this.lockOverlayInterval = null;
    this.lockOverlayRemaining = 0;
    this.isLockTimerPaused = false;
    // Queue actions while offline
    this.pendingAutoSubmit = false;
    
    this.init();
  }

  async init() {
    // Ensure a clean state for each new exam session by resetting violations.
    await this.resetViolationState();

    // Load settings from extension storage
    await this.loadSettings();
    
    // Set up message listener for reset commands
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'resetViolations') {
        this.resetViolationState();
      }
      return true;
    });
    
    // Check if already locked from previous session (e.g., from settings)
    await this.checkPreviousViolation();
    
    // Set up fullscreen mode if enabled
    if (this.settings.enableFullscreen) {
      this.setupFullscreenMode();
    }
    
    // Set up visibility monitoring
    this.setupVisibilityMonitoring();
    
    // Set up beforeunload protection
    this.setupNavigationProtection();

    // Inject all UI elements
    this.injectUIElements();

    // Setup network connectivity failsafe
    this.setupOfflineHandling();
    
    console.log('Exam Lock Extension initialized with fullscreen support');
    
    // Start exam timer if enabled
    if (this.settings.enableExamTimer) {
      this.startExamTimer();
    } else {
      // Ensure the timer display is hidden if not enabled
      const timerDisplay = document.getElementById('exam-lock-timer-display');
      if (timerDisplay) timerDisplay.style.display = 'none';
    }
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get('examLockSettings');
      if (result.examLockSettings) {
        this.settings = { ...this.settings, ...result.examLockSettings };
      }
    } catch (error) {
      console.log('Using default settings');
    }
  }

  setupFullscreenMode() {
    // Wait for page to be fully loaded before requesting fullscreen
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => this.requestFullscreen(), 1000);
      });
    } else {
      setTimeout(() => this.requestFullscreen(), 1000);
    }

    // Monitor fullscreen changes
    document.addEventListener('fullscreenchange', () => {
      this.handleFullscreenChange();
    });

    // Block F11 key and other fullscreen toggles
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F11') {
        e.preventDefault();
        if (!document.fullscreenElement && this.settings.forceFullscreen) {
          this.handleFullscreenViolation();
        }
      }
      
      // Block Escape key when in fullscreen (prevents exiting)
      if (e.key === 'Escape' && document.fullscreenElement && this.settings.forceFullscreen) {
        e.preventDefault();
        e.stopPropagation();
        this.showFullscreenWarning();
      }
    });

    // Detect attempts to exit fullscreen via browser UI
    window.addEventListener('resize', () => {
      if (this.isFullscreenActive && !document.fullscreenElement && this.settings.forceFullscreen) {
        setTimeout(() => {
          if (!document.fullscreenElement) {
            this.handleFullscreenViolation();
          }
        }, 100);
      }
    });
  }

  async requestFullscreen() {
    if (this.settings.enableFullscreen && !document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
        this.isFullscreenActive = true;
        this.hideFullscreenPrompt();
      } catch (error) {
        console.log('Fullscreen request failed:', error);
        this.fullscreenAttempts++;
        
        if (this.settings.forceFullscreen) {
          this.showFullscreenPrompt();
          
          if (this.fullscreenAttempts >= this.maxFullscreenAttempts) {
            this.handleFullscreenViolation();
          } else {
            // Retry after a delay
            setTimeout(() => this.requestFullscreen(), 3000);
          }
        }
      }
    }
  }

  handleFullscreenChange() {
    if (document.fullscreenElement) {
      this.isFullscreenActive = true;
      this.hideFullscreenPrompt();
    } else {
      this.isFullscreenActive = false;
      
      if (this.settings.forceFullscreen && !this.isLocked) {
        this.handleFullscreenViolation();
      }
    }
  }

  handleFullscreenViolation() {
    this.violationCount++;
    chrome.storage.local.set({ examLockViolations: this.violationCount });
    
    // Log the violation
    this.logViolation('Fullscreen exit attempt');
    
    if (this.settings.forceFullscreen) {
      // Show violation message and try to re-enter fullscreen
      this.showFullscreenViolation();
      
      // Attempt to re-enter fullscreen after a delay
      setTimeout(() => {
        if (!document.fullscreenElement) {
          this.requestFullscreen();
        }
      }, 2000);
      
      // If too many violations, trigger security action
      if (this.violationCount >= this.settings.maxViolations) {
        this.isLocked = true;
        chrome.storage.local.set({ 
          examLockState: { isLocked: true }
        });
        this.activateSecurityMeasure();
      }
    }
  }

  showFullscreenPrompt() {
    const prompt = document.getElementById('fullscreen-prompt');
    if (prompt) {
      prompt.style.display = 'flex';
    }
  }

  hideFullscreenPrompt() {
    const prompt = document.getElementById('fullscreen-prompt');
    if (prompt) {
      prompt.style.display = 'none';
    }
  }

  showFullscreenViolation() {
    const overlay = document.getElementById('exam-lock-overlay');
    const messageEl = overlay.querySelector('.lock-message');
    
    messageEl.textContent = `FULLSCREEN VIOLATION DETECTED\nAttempt ${this.violationCount} of ${this.settings.maxViolations}\n\nYou must remain in fullscreen mode during the exam.`;
    overlay.style.display = 'flex';
    
    // Auto-hide after 3 seconds if not permanently locked
    if (this.violationCount < this.settings.maxViolations) {
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 3000);
    } else {
      this.disableFormInteractions();
    }
  }

  showFullscreenWarning() {
    // Create temporary warning for escape key attempts
    const warning = document.createElement('div');
    warning.id = 'fullscreen-warning';
    warning.innerHTML = `
      <div class="warning-content">
        <div class="warning-icon">⚠️</div>
        <div class="warning-text">You cannot exit fullscreen mode during the exam</div>
      </div>
    `;
    document.body.appendChild(warning);
    
    setTimeout(() => {
      if (document.getElementById('fullscreen-warning')) {
        document.body.removeChild(warning);
      }
    }, 2000);
  }

  async checkPreviousViolation() {
    try {
      const result = await chrome.storage.local.get(['examLockViolations', 'examLockState']);
      this.violationCount = result.examLockViolations || 0;
      this.isLocked = result.examLockState?.isLocked || false;
      
      if (this.isLocked) {
        this.activateSecurityMeasure();
      }
    } catch (error) {
      console.error('Error loading previous violation state:', error);
    }
  }

  setupVisibilityMonitoring() {
    // Primary visibility change listener
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this.isLocked) {
        this.handleVisibilityChange();
      }
    });

    // Additional detection methods
    window.addEventListener('blur', () => {
      if (!this.isLocked) {
        this.handleVisibilityChange();
      }
    });

    window.addEventListener('focus', () => {
      if (this.isLocked && this.settings.mode === 'timer') {
        this.showTimerOverlay();
      }
      
      // Re-request fullscreen if needed
      if (this.settings.enableFullscreen && !document.fullscreenElement) {
        setTimeout(() => this.requestFullscreen(), 500);
      }
    });

    // Detect Alt+Tab and other key combinations
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'Tab') {
        e.preventDefault();
        this.handleVisibilityChange();
      }
      
      // Prevent common shortcuts
      if (e.ctrlKey && (e.key === 't' || e.key === 'w' || e.key === 'n')) {
        e.preventDefault();
        this.handleVisibilityChange();
      }
      
      // Block F5 (refresh), F12 (dev tools)
      if (e.key === 'F5' || e.key === 'F12') {
        e.preventDefault();
      }
    });
  }

  async handleVisibilityChange() {
    if (document.hidden) {
      this.violationCount++;
      chrome.storage.local.set({ examLockViolations: this.violationCount });
      
      if (this.violationCount >= this.settings.maxViolations) {
        this.isLocked = true;
        chrome.storage.local.set({ 
          examLockState: { isLocked: true }
        });
        this.activateSecurityMeasure();
      } else {
        this.showWarning();
      }
    }
  }

  activateSecurityMeasure() {
    // Clear any existing timer
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    
    switch(this.settings.mode) {
      case 'submit':
        this.autoSubmitForm();
        break;
      case 'overlay':
        this.showLockOverlay();
        break;
      case 'timer':
        this.startTimerLock();
        break;
    }
  }

  async resetViolationState() {
    this.violationCount = 0;
    this.isLocked = false;
    chrome.storage.local.remove(['examLockViolations', 'examLockState']);
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
  }

  setupNavigationProtection() {
    window.addEventListener('beforeunload', (e) => {
      if (!this.isLocked) {
        const message = 'Are you sure you want to leave the exam? This may be recorded as a violation.';
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    });
  }

  handleVisibilityViolation() {
    if (this.isLocked) return;
    
    this.violationCount++;
    chrome.storage.local.set({ examLockViolations: this.violationCount });
    
    // Log the violation
    this.logViolation('Tab switch/visibility change');
    
    // Trigger appropriate security action
    if (this.violationCount >= this.settings.maxViolations) {
      this.isLocked = true;
      chrome.storage.local.set({ 
        examLockState: { isLocked: true }
      });
      this.activateSecurityMeasure();
    }
  }

  triggerSecurityAction(fromPreviousSession = false) {
    switch (this.settings.mode) {
      case 'submit':
        this.autoSubmitForm();
        break;
      case 'overlay':
        this.showLockOverlay();
        break;
      case 'timer':
        this.showTimerOverlay();
        break;
    }
    
    if (!fromPreviousSession) {
      chrome.storage.local.set({ 
        examLockState: { isLocked: true }
      });
    }
  }

  autoSubmitForm() {
    // If offline, queue submission and inform the user
    if (!navigator.onLine) {
      this.pendingAutoSubmit = true;
      this.showLockOverlay('Network disconnected. Your exam will be submitted automatically once connection is restored.');
      return;
    }

    this.showLockOverlay('Your exam has been automatically submitted due to security violations.');

    const form = document.querySelector('form');
    if (form && typeof form.submit === 'function') {
      try {
        this.addViolationNote();
        form.submit();
        return;
      } catch (e) {
        console.warn('Exam Lock: direct form.submit failed, will try clicking a submit-like button.', e);
      }
    }

    const submitButton = document.querySelector('[type="submit"]') || 
                        document.querySelector('[role="button"][aria-label*="Submit"]') ||
                        Array.from(document.querySelectorAll('div[role="button"]')).find(el => (el.textContent || '').toLowerCase().includes('submit'));
    
    if (submitButton) {
      // Add violation note before submitting
      this.addViolationNote();
      submitButton.click();
    } else {
      console.warn('Exam Lock: Could not find a submit button to auto-submit the form.');
    }
  }

  // Show a non-blocking warning banner for minor violations
  showWarning() {
    let el = document.getElementById('exam-lock-warning-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'exam-lock-warning-banner';
      el.innerHTML = `
        <div class="warning-icon">⚠️</div>
        <div class="warning-text">${this.settings.warningMessage}</div>
      `;
      document.body.appendChild(el);
    }
    el.style.display = 'flex';
    setTimeout(() => {
      if (el) el.style.display = 'none';
    }, 3000);
  }

  

  showTimerOverlay() {
    this.isLocked = true;
    const overlay = document.getElementById('exam-lock-overlay');
    const messageEl = overlay.querySelector('.lock-message');
    const timerEl = overlay.querySelector('.timer-display');

    // Initialize remaining time (seconds) for the temporary lock if not already set
    this.lockOverlayRemaining = this.settings.timerDuration;

    const tick = () => {
      if (this.isLockTimerPaused) return;
      const minutes = Math.floor(this.lockOverlayRemaining / 60);
      const seconds = this.lockOverlayRemaining % 60;
      const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

      messageEl.textContent = this.settings.timerMessage.replace('{time}', timeString);
      timerEl.textContent = timeString;

      if (this.lockOverlayRemaining <= 0) {
        clearInterval(this.lockOverlayInterval);
        this.lockOverlayInterval = null;
        this.unlockExam();
      } else {
        this.lockOverlayRemaining--;
      }
    };

    overlay.style.display = 'flex';
    timerEl.style.display = 'block';
    this.disableFormInteractions();

    // Clear any previous interval before starting a new one
    if (this.lockOverlayInterval) clearInterval(this.lockOverlayInterval);
    this.isLockTimerPaused = false;
    this.lockOverlayInterval = setInterval(tick, 1000);
    tick();
  }

  unlockExam() {
    this.isLocked = false;
    const overlay = document.getElementById('exam-lock-overlay');
    overlay.style.display = 'none';
    
    // Re-enable form interactions
    this.enableFormInteractions();
    
    // Re-request fullscreen if needed
    if (this.settings.enableFullscreen && !document.fullscreenElement) {
      setTimeout(() => this.requestFullscreen(), 500);
    }
  }

  disableFormInteractions() {
    const formElements = document.querySelectorAll('input, textarea, select, button, [role="button"]');
    formElements.forEach(el => {
      el.setAttribute('data-exam-lock-disabled', el.disabled || 'false');
      el.disabled = true;
      el.style.pointerEvents = 'none';
    });
  }

  enableFormInteractions() {
    const formElements = document.querySelectorAll('[data-exam-lock-disabled]');
    formElements.forEach(el => {
      const wasDisabled = el.getAttribute('data-exam-lock-disabled') === 'true';
      if (!wasDisabled) {
        el.disabled = false;
        el.style.pointerEvents = '';
      }
      el.removeAttribute('data-exam-lock-disabled');
    });
  }

  addViolationNote() {
    // Try to find a text area or add a hidden field with violation info
    const textAreas = document.querySelectorAll('textarea');
    if (textAreas.length > 0) {
      const lastTextArea = textAreas[textAreas.length - 1];
      const violationNote = `\n\n[SECURITY VIOLATIONS: ${this.violationCount} detected at ${new Date().toISOString()}]`;
      lastTextArea.value += violationNote;
    }
  }

  logViolation(type = 'Unknown') {
    const violationData = {
      type: type,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
      violationCount: this.violationCount,
      fullscreenActive: this.isFullscreenActive
    };
    
    console.warn('Exam Security Violation:', violationData);
    
    // Store violation in session storage for persistence
    const violations = JSON.parse(sessionStorage.getItem('examViolations') || '[]');
    violations.push(violationData);
    sessionStorage.setItem('examViolations', JSON.stringify(violations));

    // Forward to background for auditing/forwarding
    try {
      chrome.runtime.sendMessage({ type: 'violationEvent', data: violationData });
    } catch {}
  }

  injectUIElements() {
    if (document.getElementById('exam-lock-overlay')) return;
    
    const overlay = document.createElement('div');
    overlay.id = 'exam-lock-overlay';
    overlay.innerHTML = `
      <div class="lock-content">
        <div class="lock-icon">🔒</div>
        <div class="lock-message">Security violation detected</div>
        <div class="timer-display" style="display: none;">00:00</div>
        <div class="violation-count">Violations: <span id="violation-counter">${this.violationCount}</span></div>
        <div class="contact-info">
          <p>Contact your instructor if this is an error.</p>
          <p><strong>Do not close this tab or refresh the page.</strong></p>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Add fullscreen prompt overlay
    const fullscreenPrompt = document.createElement('div');
    fullscreenPrompt.id = 'fullscreen-prompt';
    fullscreenPrompt.innerHTML = `
      <div class="fullscreen-content">
        <div class="fullscreen-icon">⛶</div>
        <div class="fullscreen-message">${this.settings.fullscreenMessage}</div>
        <button id="fullscreen-allow-btn" class="fullscreen-btn">Enter Fullscreen</button>
        <div class="fullscreen-info">
          <p>This exam requires fullscreen mode for security.</p>
          <p>Click "Enter Fullscreen" or press F11 to continue.</p>
        </div>
      </div>
    `;
    
    document.body.appendChild(fullscreenPrompt);
    
    // Add click handler for fullscreen button
    document.getElementById('fullscreen-allow-btn').addEventListener('click', () => {
      this.requestFullscreen();
    });
    
    // Update violation counter when it changes
    const updateCounter = () => {
      const counter = document.getElementById('violation-counter');
      if (counter) counter.textContent = this.violationCount;
    };
    
    // Update counter periodically
    setInterval(updateCounter, 1000);

    // Add the main exam timer display
    const timerDisplay = document.createElement('div');
    timerDisplay.id = 'exam-lock-timer-display';
    document.body.appendChild(timerDisplay);

    // Add an offline banner for connectivity issues
    const offlineBanner = document.createElement('div');
    offlineBanner.id = 'exam-lock-offline-banner';
    offlineBanner.style.display = 'none';
    offlineBanner.innerHTML = `
      <div class="offline-icon">📶</div>
      <div class="offline-text">You're offline. Timer paused until connection is restored.</div>
    `;
    document.body.appendChild(offlineBanner);
  }

  startExamTimer() {
    // Convert minutes to milliseconds
    const durationMs = this.settings.examDuration * 60 * 1000;
    const warningTimeMs = this.settings.timerWarningTime * 60 * 1000;
    
    this.timeRemaining = durationMs;
    
    // Update timer every second
    this.examTimer = setInterval(() => {
      this.timeRemaining -= 1000;
      this.updateTimerDisplay();

      // Show warning if time is running out
      if (!this.timerWarningShown && this.timeRemaining <= warningTimeMs) {
        this.showTimerWarning();
        this.timerWarningShown = true;
      }
      
      // Handle timer expiration
      if (this.timeRemaining <= 0) {
        clearInterval(this.examTimer);
        this.handleTimerExpiration();
      }
    }, 1000);

    // Initial display update
    this.updateTimerDisplay();
  }

  setupOfflineHandling() {
    window.addEventListener('offline', () => {
      this.isOffline = true;
      const banner = document.getElementById('exam-lock-offline-banner');
      if (banner) banner.style.display = 'flex';
      // Log event locally and to background for audit
      const event = {
        type: 'offline',
        timestamp: new Date().toISOString(),
        url: window.location.href,
        strictMode: this.settings.strictMode,
      };
      try {
        chrome.runtime.sendMessage({ type: 'connectivityEvent', data: event });
        chrome.storage.local.get('connectivityEvents', (res) => {
          const list = res.connectivityEvents || [];
          list.push(event);
          chrome.storage.local.set({ connectivityEvents: list });
        });
      } catch {}

      if (!this.settings.strictMode) {
        // Pause main exam timer if running
        if (this.examTimer) {
          this.timerWasRunningBeforeOffline = true;
          clearInterval(this.examTimer);
          this.examTimer = null;
        } else {
          this.timerWasRunningBeforeOffline = false;
        }
        // Pause temporary lock timer if active
        if (this.lockOverlayInterval) {
          this.isLockTimerPaused = true;
        }
      }
    });

    window.addEventListener('online', () => {
      this.isOffline = false;
      const banner = document.getElementById('exam-lock-offline-banner');
      if (banner) banner.style.display = 'none';
      // Log event locally and to background for audit
      const event = {
        type: 'online',
        timestamp: new Date().toISOString(),
        url: window.location.href,
        strictMode: this.settings.strictMode,
      };
      try {
        chrome.runtime.sendMessage({ type: 'connectivityEvent', data: event });
        chrome.storage.local.get('connectivityEvents', (res) => {
          const list = res.connectivityEvents || [];
          list.push(event);
          chrome.storage.local.set({ connectivityEvents: list });
        });
      } catch {}

      if (!this.settings.strictMode) {
        // Resume main exam timer if it was running before
        if (this.settings.enableExamTimer && this.timerWasRunningBeforeOffline && !this.examTimer && this.timeRemaining > 0) {
          this.startExamTimer();
        }
        // Resume temporary lock timer if it was paused
        if (this.lockOverlayInterval && this.isLockTimerPaused) {
          this.isLockTimerPaused = false;
        }
      }
      // Process pending auto-submit if any
      if (this.pendingAutoSubmit) {
        this.pendingAutoSubmit = false;
        this.autoSubmitForm();
      }
    });
  }

  showTimerWarning() {
    const warningElement = document.createElement('div');
    warningElement.className = 'exam-timer-warning';
    warningElement.innerHTML = `
      <div class="warning">
        <strong>⚠️ Time Warning:</strong> 
        ${this.settings.timerWarningTime} minute(s) remaining in exam!
      </div>
    `;
    document.body.appendChild(warningElement);
  }

  handleTimerExpiration() {
    switch(this.settings.timerAction) {
      case 'submit':
        if (!navigator.onLine) {
          // Queue submission until connectivity is restored
          this.pendingAutoSubmit = true;
          this.showLockOverlay('EXAM TIME EXPIRED\nWaiting for connection to submit your exam automatically...');
        } else {
          this.autoSubmitForm();
        }
        break;
      case 'lock':
        this.showLockOverlay(
          'EXAM TIME EXPIRED\nThe allocated time for this exam has ended.',
          true
        );
        break;
      case 'warn':
        this.showTimerWarning();
        setTimeout(() => this.autoSubmitForm(), 30000); // Submit after 30 seconds warning
        break;
    }
  }

  updateTimerDisplay() {
    const timerDisplay = document.getElementById('exam-lock-timer-display');
    if (!timerDisplay) return;

    const minutes = Math.floor(this.timeRemaining / 60000);
    const seconds = Math.floor((this.timeRemaining % 60000) / 1000);

    timerDisplay.innerHTML = `
      <div class="timer-icon">⏳</div>
      <div class="timer-text">Time Remaining: <strong>${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}</strong></div>
    `;
  }

  // Display lock overlay with optional custom message
  showLockOverlay(customMessage = this.settings.lockMessage, fromTimer = false) {
    this.injectUIElements();
    const overlay = document.getElementById('exam-lock-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      const msg = overlay.querySelector('.lock-message');
      if (msg && customMessage) {
        msg.textContent = customMessage;
      }
    }
    // Persist locked state
    this.isLocked = true;
    chrome.storage.local.set({ examLockState: { isLocked: true, fromTimer } });
  }

  // Removed duplicate autoSubmitForm implementation; unified version is defined above.

  cleanup() {
    // Clear exam timer when cleaning up
    if (this.examTimer) {
      clearInterval(this.examTimer);
    }
    // ... rest of existing cleanup
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new ExamLock();
  });
} else {
  new ExamLock();
}

// Also initialize immediately for good measure
window.addEventListener('load', () => {
  if (!window.examLockInstance) {
    window.examLockInstance = new ExamLock();
  }
});

// Listen for custom events from background script
window.addEventListener('examLockTabActivated', () => {
  if (window.examLockInstance && window.examLockInstance.settings.enableFullscreen) {
    setTimeout(() => window.examLockInstance.requestFullscreen(), 500);
  }
});

window.addEventListener('examLockWindowBlur', () => {
  if (window.examLockInstance) {
    window.examLockInstance.handleVisibilityChange();
  }
});