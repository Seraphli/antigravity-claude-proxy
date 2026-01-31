/**
 * Logs Viewer Component
 * Registers itself to window.Components for Alpine.js to consume
 */
window.Components = window.Components || {};

window.Components.logsViewer = () => {
    // Non-reactive buffer for high-frequency logs
    let logBuffer = [];

    return {
        logs: [],
        isAutoScroll: true,
        eventSource: null,
        searchQuery: '',
        filters: {
            INFO: true,
            WARN: true,
            ERROR: true,
            SUCCESS: true,
            DEBUG: false
        },

        get filteredLogs() {
            const query = this.searchQuery.trim();
            if (!query) {
                return this.logs.filter(log => this.filters[log.level]);
            }

            // Try regex first, fallback to plain text search
            let matcher;
            try {
                const regex = new RegExp(query, 'i');
                matcher = (msg) => regex.test(msg);
            } catch (e) {
                // Invalid regex, fallback to case-insensitive string search
                const lowerQuery = query.toLowerCase();
                matcher = (msg) => msg.toLowerCase().includes(lowerQuery);
            }

            return this.logs.filter(log => {
                // Level Filter
                if (!this.filters[log.level]) return false;

                // Search Filter
                return matcher(log.message);
            });
        },

        init() {
            this.startLogStream();

            // Flush logs periodically to prevent DOM freezing on high-throughput
            setInterval(() => this.flushLogs(), 100);

            this.$watch('isAutoScroll', (val) => {
                if (val) this.scrollToBottom();
            });

            // Watch filters to maintain auto-scroll if enabled
            this.$watch('searchQuery', () => { if(this.isAutoScroll) this.$nextTick(() => this.scrollToBottom()) });
            this.$watch('filters', () => { if(this.isAutoScroll) this.$nextTick(() => this.scrollToBottom()) });
        },

        flushLogs() {
            if (logBuffer.length === 0) return;

            const limit = Alpine.store('settings')?.logLimit || window.AppConstants.LIMITS.DEFAULT_LOG_LIMIT;

            // Efficiently merge buffer into logs
            // 1. If buffer itself exceeds limit, just take the end of buffer
            if (logBuffer.length >= limit) {
                this.logs = logBuffer.slice(-limit);
            } else {
                // 2. Append buffer
                // Use functional update to avoid intermediate reactivity if possible, though assignment triggers it once
                const currentLen = this.logs.length;
                const bufferLen = logBuffer.length;
                
                if (currentLen + bufferLen <= limit) {
                    // Fast path: just push (Alpine proxies push)
                    // But for large batches, replacing array might be cleaner for Vue/Alpine internals than 100 pushes
                    // Let's use concat which creates a new array reference - reliable reactivity
                    this.logs = this.logs.concat(logBuffer);
                } else {
                    // Needs slicing
                    const newLogs = this.logs.concat(logBuffer);
                    this.logs = newLogs.slice(-limit);
                }
            }
            
            // Clear buffer
            logBuffer = [];

            if (this.isAutoScroll) {
                this.$nextTick(() => this.scrollToBottom());
            }
        },

        startLogStream() {
            if (this.eventSource) this.eventSource.close();

            const password = Alpine.store('global').webuiPassword;
            const url = password
                ? `/api/logs/stream?history=true&password=${encodeURIComponent(password)}`
                : '/api/logs/stream?history=true';

            this.eventSource = new EventSource(url);
            this.eventSource.onmessage = (event) => {
                try {
                    const log = JSON.parse(event.data);
                    // Push to non-reactive buffer instead of this.logs directly
                    logBuffer.push(log);
                } catch (e) {
                    if (window.UILogger) window.UILogger.debug('Log parse error:', e.message);
                }
            };

            this.eventSource.onerror = () => {
                if (window.UILogger) window.UILogger.debug('Log stream disconnected, reconnecting...');
                setTimeout(() => this.startLogStream(), 3000);
            };
        },

        scrollToBottom() {
            const container = document.getElementById('logs-container');
            if (container) container.scrollTop = container.scrollHeight;
        },

        clearLogs() {
            this.logs = [];
            logBuffer = [];
        }
    };
};
