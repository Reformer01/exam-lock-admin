// Background Service Worker for Exam Lock Extension

// Service Worker Lifecycle Events
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Exam Lock Extension installed:', details.reason);
  
  // Initialize default settings
  initializeDefaultSettings();
});

// Clean up when service worker stops
chrome.runtime.onSuspend.addListener(() => {
  console.log('Service worker shutting down');
});

async function initializeDefaultSettings() {
  try {
    const result = await chrome.storage.sync.get('examLockSettings');
    if (!result.examLockSettings) {
      const defaultSettings = {
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
        strictMode: false
      };
      
      await chrome.storage.sync.set({ examLockSettings: defaultSettings });
    }

async function persistViolationEvent(event) {
  try {
    const { violationEvents = [], examLockBackend } = await chrome.storage.local.get([
      'violationEvents',
      'examLockBackend',
    ]);

    const updated = violationEvents.concat([event]).slice(-1000);
    await chrome.storage.local.set({ violationEvents: updated });

    if (examLockBackend && examLockBackend.enabled && examLockBackend.endpoint && examLockBackend.apiKey) {
      fetch(examLockBackend.endpoint + '/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${examLockBackend.apiKey}`,
        },
        body: JSON.stringify({ type: 'violation', payload: event }),
      }).catch((e) => console.warn('Backend forwarding failed:', e.message));
    }
  } catch (e) {
    console.error('Failed to persist violation event:', e);
  }
}
  } catch (error) {
    console.error('Failed to initialize settings:', error);
  }
}

// Tab monitoring with proper error handling
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    
    if (tab.url && isGoogleFormUrl(tab.url)) {
      await handleGoogleFormTab(tab);
    }
  } catch (error) {
    console.error('Tab monitoring error:', error);
  }
});

function isGoogleFormUrl(url) {
  return url.includes('docs.google.com/forms') || 
         url.includes('forms.google.com');
}

async function handleGoogleFormTab(tab) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (window.examLockInstance) {
          window.dispatchEvent(new CustomEvent('examLockTabActivated'));
        }
      }
    });
  } catch (error) {
    console.error('Script injection failed:', error);
  }
}

// Handle window focus changes
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // All Chrome windows lost focus
    try {
      const tabs = await chrome.tabs.query({ 
        url: ['*://docs.google.com/forms/*', '*://forms.google.com/*'] 
      });
      
      tabs.forEach(tab => {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            if (window.examLockInstance) {
              // Trigger violation for losing window focus
              window.dispatchEvent(new CustomEvent('examLockWindowBlur'));
            }
          }
        });
      });
    } catch (error) {
      console.error('Focus change detection failed:', error);
    }
  }
});

// Monitor fullscreen changes across tabs
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && 
      (tab.url.includes('docs.google.com/forms') || tab.url.includes('forms.google.com'))) {
    
    try {
      // Check if fullscreen is enabled in settings
      const result = await chrome.storage.sync.get('examLockSettings');
      const settings = result.examLockSettings;
      
      if (settings && settings.enableFullscreen) {
        // Inject fullscreen monitoring
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: (enableFullscreen, forceFullscreen) => {
            if (window.examLockInstance && enableFullscreen) {
              // Ensure fullscreen is requested
              setTimeout(() => {
                if (!document.fullscreenElement) {
                  window.examLockInstance.requestFullscreen();
                }
              }, 1000);
            }
          },
          args: [settings.enableFullscreen, settings.forceFullscreen]
        });
      }
    } catch (error) {
      console.error('Fullscreen monitoring failed:', error);
    }
  }
});

// Message handling for communication with content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'logViolation':
      console.warn('Exam violation logged:', message.data);
      // Here you could send to a server endpoint if needed
      break;
      
    case 'getSettings':
      chrome.storage.sync.get('examLockSettings', (result) => {
        sendResponse(result.examLockSettings);
      });
      return true; // Keep message channel open for async response
      
    case 'updateSettings':
      chrome.storage.sync.set({ examLockSettings: message.settings }, () => {
        sendResponse({ success: true });
      });
      return true;

    case 'requestFullscreen':
      // Handle fullscreen requests from content scripts
      if (sender.tab) {
        chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          func: () => {
            if (!document.fullscreenElement) {
              document.documentElement.requestFullscreen().catch(console.log);
            }
          }
        });
      }
      break;

    case 'fullscreenViolation':
      console.warn('Fullscreen violation detected:', message.data);
      // Log fullscreen violations
      break;

    case 'connectivityEvent': {
      // Persist event locally and optionally forward to backend
      const event = message.data;
      persistConnectivityEvent(event);
      // no sendResponse needed
      break;
    }

    case 'violationEvent': {
      const event = message.data;
      persistViolationEvent(event);
      break;
    }
  }
});

// Periodic check for exam forms and fullscreen status
setInterval(async () => {
  try {
    const tabs = await chrome.tabs.query({ 
      url: ['*://docs.google.com/forms/*', '*://forms.google.com/*'] 
    });
    
    const result = await chrome.storage.sync.get('examLockSettings');
    const settings = result.examLockSettings;
    
    if (settings && settings.enableFullscreen) {
      tabs.forEach(tab => {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (forceFullscreen) => {
            // Heartbeat check - ensure content script is still active and fullscreen if required
            if (!window.examLockInstance) {
              console.log('Reinitializing Exam Lock...');
            } else if (forceFullscreen && !document.fullscreenElement) {
              // Re-request fullscreen if it was lost
              window.examLockInstance.requestFullscreen();
            }
          },
          args: [settings.forceFullscreen]
        });
      });
    }
  } catch (error) {
    console.error('Periodic check failed:', error);
  }
}, 30000);

// Persist connectivity events in a capped ring buffer and optionally forward to backend
async function persistConnectivityEvent(event) {
  try {
    const { connectivityEvents = [], examLockBackend } = await chrome.storage.local.get([
      'connectivityEvents',
      'examLockBackend',
    ]);

    // Append and cap to last 500 entries
    const updated = connectivityEvents.concat([event]).slice(-500);
    await chrome.storage.local.set({ connectivityEvents: updated });

    // Optionally forward to backend if configured
    if (examLockBackend && examLockBackend.enabled && examLockBackend.endpoint && examLockBackend.apiKey) {
      fetch(examLockBackend.endpoint + '/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${examLockBackend.apiKey}`,
        },
        body: JSON.stringify({ type: 'connectivity', payload: event }),
      }).catch((e) => console.warn('Backend forwarding failed:', e.message));
    }
  } catch (e) {
    console.error('Failed to persist connectivity event:', e);
  }
}

// Handle extension icon click (optional - could show status)
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && (tab.url.includes('docs.google.com/forms') || tab.url.includes('forms.google.com'))) {
    // Show current status or force fullscreen
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (window.examLockInstance) {
          console.log('Exam Lock Status:', {
            violations: window.examLockInstance.violationCount,
            locked: window.examLockInstance.isLocked,
            fullscreen: document.fullscreenElement ? true : false
          });
        }
      }
    });
  }
});