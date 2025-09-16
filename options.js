// Options page JavaScript for Exam Lock Extension

class SettingsManager {
  constructor() {
    this.form = document.getElementById('settingsForm');
    this.status = document.getElementById('status');
    this.resetBtn = document.getElementById('resetBtn');
    
    this.defaultSettings = {
      mode: 'overlay',
      timerDuration: 30,
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
      examDuration: 60,
      timerAction: 'submit',
      timerWarningTime: 5
    };
    
    document.getElementById('enableExamTimer').addEventListener('change', (e) => {
      this.updateTimerUI(e.target.checked);
    });
    
    this.init();
    
    // Add clear violations button handler
    document.getElementById('clearViolationsBtn').addEventListener('click', () => {
      this.clearViolations();
    });
  }
  
  init() {
    this.loadSettings();
    this.bindEvents();
  }
  
  bindEvents() {
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveSettings();
    });
    
    this.resetBtn.addEventListener('click', () => {
      this.resetToDefaults();
    });
    
    // Mode-specific UI updates
    document.getElementById('mode').addEventListener('change', (e) => {
      this.updateModeUI(e.target.value);
    });

    // Fullscreen-specific UI updates
    document.getElementById('enableFullscreen').addEventListener('change', (e) => {
      this.updateFullscreenUI(e.target.checked);
    });
  }
  
  updateModeUI(mode) {
    const timerSection = document.querySelector('.section:nth-child(4)');
    const timerMessageField = document.getElementById('timerMessage').closest('label');
    
    if (mode === 'timer') {
      timerSection.style.opacity = '1';
      timerMessageField.style.display = 'block';
    } else {
      timerSection.style.opacity = '0.5';
      timerMessageField.style.display = mode === 'timer' ? 'block' : 'none';
    }
  }

  updateFullscreenUI(enabled) {
    const forceFullscreenCheckbox = document.getElementById('forceFullscreen');
    const fullscreenMessageField = document.getElementById('fullscreenMessage');
    
    forceFullscreenCheckbox.disabled = !enabled;
    fullscreenMessageField.disabled = !enabled;
    
    if (!enabled) {
      forceFullscreenCheckbox.checked = false;
    }
  }
  
  updateTimerUI(enabled) {
    const timerSettings = document.getElementById('examTimerSettings');
    timerSettings.style.display = enabled ? 'block' : 'none';
    
    // Enable/disable all timer inputs
    const inputs = timerSettings.querySelectorAll('input, select');
    inputs.forEach(input => {
      input.disabled = !enabled;
    });
  }
  
  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get('examLockSettings');
      const settings = result.examLockSettings || this.defaultSettings;
      const backend = await chrome.storage.local.get('examLockBackend');
      const backendCfg = backend.examLockBackend || {};
      
      // Populate form fields
      Object.keys(settings).forEach(key => {
        const element = document.getElementById(key);
        if (element) {
          if (element.type === 'checkbox') {
            element.checked = settings[key];
          } else {
            // For timerDuration, show minutes in the UI (convert from seconds)
            if (key === 'timerDuration') {
              const minutes = Math.max(1, Math.round((settings[key] || 60) / 60));
              element.value = minutes;
            } else {
              element.value = settings[key];
            }
          }
        }
      });

      // Populate backend fields (local only)
      const fwdEl = document.getElementById('forwardingEnabled');
      const endpointEl = document.getElementById('backendEndpoint');
      const apiKeyEl = document.getElementById('backendApiKey');
      if (fwdEl) fwdEl.checked = !!backendCfg.enabled;
      if (endpointEl) endpointEl.value = backendCfg.endpoint || '';
      if (apiKeyEl) apiKeyEl.value = backendCfg.apiKey || '';
      
      this.updateModeUI(settings.mode);
      this.updateFullscreenUI(settings.enableFullscreen);
      this.updateTimerUI(settings.enableExamTimer);
      this.showStatus('Settings loaded successfully', 'success');
      
    } catch (error) {
      this.showStatus('Error loading settings: ' + error.message, 'error');
    }
  }
  
  async saveSettings() {
    try {
      const formData = new FormData(this.form);
      const settings = {};
      const backendCfg = {};
      
      // Collect form data
      for (let [key, value] of formData.entries()) {
        const element = document.getElementById(key);
        if (element.type === 'checkbox') {
          if (key === 'forwardingEnabled') {
            backendCfg.enabled = element.checked;
          } else {
            settings[key] = element.checked;
          }
        } else if (element.type === 'number') {
          let parsed = parseInt(value, 10);
          if (key === 'timerDuration') {
            // Convert minutes (UI) to seconds (storage)
            parsed = Math.min(60, Math.max(1, parsed));
            settings[key] = parsed * 60;
          } else {
            settings[key] = parsed;
          }
        } else {
          if (key === 'backendEndpoint') {
            backendCfg.endpoint = value.trim();
            continue;
          }
          if (key === 'backendApiKey') {
            backendCfg.apiKey = value.trim();
            continue;
          }
          settings[key] = value;
        }
      }
      
      // Handle unchecked checkboxes (they don't appear in FormData)
      const checkboxes = ['enableFullscreen', 'forceFullscreen', 'enableLogging', 'strictMode', 'enableExamTimer'];
      checkboxes.forEach(checkbox => {
        if (!(checkbox in settings)) {
          settings[checkbox] = false;
        }
      });
      
      // Validate settings
      // Validate timerDuration (stored as seconds); UI constrains 1..60 minutes
      if (settings.timerDuration < 60 || settings.timerDuration > 3600) {
        throw new Error('Timer duration must be between 1 and 60 minutes');
      }
      
      if (settings.maxViolations < 1 || settings.maxViolations > 10) {
        throw new Error('Max violations must be between 1 and 10');
      }

      // If fullscreen is disabled, also disable force fullscreen
      if (!settings.enableFullscreen) {
        settings.forceFullscreen = false;
      }
      
      // Save to storage
      await chrome.storage.sync.set({ examLockSettings: settings });
      await chrome.storage.local.set({ examLockBackend: backendCfg });
      
      this.showStatus('✅ Settings saved successfully! Changes will apply to new exam sessions.', 'success');
      
      // Notify all active content scripts of setting changes
      this.notifyContentScripts(settings);
      
    } catch (error) {
      this.showStatus('❌ Error saving settings: ' + error.message, 'error');
    }
  }
  
  async resetToDefaults() {
    if (confirm('Are you sure you want to reset all settings to default values?')) {
      chrome.storage.sync.set({ examLockSettings: this.defaultSettings }, () => {
        this.showStatus('Settings reset to defaults', 'success');
        this.loadSettings();
      });
    }
  }
  
  async clearViolations() {
    try {
      // Clear violation data from storage
      await chrome.storage.local.remove(['examLockViolations', 'examLockState']);
      
      // Send message to all tabs to reset their violation state
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'resetViolations' });
        } catch (e) {
          // Tab might not be accessible or doesn't have content script
          console.log(`Could not reset tab ${tab.id}:`, e.message);
        }
      }
      
      this.showStatus('All violations cleared and exams unlocked', 'success', 'clearStatus');
    } catch (error) {
      this.showStatus('Error clearing violations: ' + error.message, 'error', 'clearStatus');
    }
  }
  
  async notifyContentScripts(settings) {
    try {
      const tabs = await chrome.tabs.query({ 
        url: ['*://docs.google.com/forms/*', '*://forms.google.com/*'] 
      });
      
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'settingsUpdated',
          settings: settings
        }).catch(() => {
          // Tab may not have content script loaded
        });
      });
    } catch (error) {
      console.log('Could not notify content scripts:', error);
    }
  }
  
  showStatus(message, type) {
    this.status.textContent = message;
    this.status.className = `status ${type}`;
    this.status.style.display = 'block';
    
    setTimeout(() => {
      this.status.style.display = 'none';
    }, 5000);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new SettingsManager();
});