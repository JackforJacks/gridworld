/**
 * SocketService - Centralized Socket.IO connection singleton
 * 
 * Provides a single shared socket connection across the entire application.
 * Eliminates duplicate connections from GridWorldApp, PopulationManager, etc.
 */

import { io, Socket } from 'socket.io-client';

/** Socket connection configuration */
interface SocketConfig {
    url: string;
    timeout: number;
    transports: string[];
    upgrade: boolean;
    reconnection: boolean;
    reconnectionDelay: number;
    reconnectionDelayMax: number;
    reconnectionAttempts: number;
    path: string;
}

/** Socket event callback type */
type SocketEventCallback = (...args: unknown[]) => void;

/** Connection state callback */
type ConnectionCallback = (connected: boolean) => void;

/**
 * SocketService Singleton
 * 
 * Usage:
 *   const socket = SocketService.getInstance();
 *   socket.on('eventName', handler);
 *   socket.emit('eventName', data);
 */
class SocketService {
    private static instance: SocketService | null = null;
    private socket: Socket | null = null;
    private isConnected: boolean = false;
    private connectionCallbacks: Set<ConnectionCallback> = new Set();
    private pendingListeners: Map<string, Set<SocketEventCallback>> = new Map();
    private connectionPromise: Promise<void> | null = null;

    /** Default socket configuration */
    private static readonly DEFAULT_CONFIG: SocketConfig = {
        url: 'http://localhost:3000',
        timeout: 30000,
        transports: ['polling'],
        upgrade: false,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
        path: '/socket.io'
    };

    private constructor() {
        // Private constructor for singleton
    }

    /**
     * Get the singleton instance
     */
    static getInstance(): SocketService {
        if (!SocketService.instance) {
            SocketService.instance = new SocketService();
        }
        return SocketService.instance;
    }

    /**
     * Get the raw Socket.IO socket (for backward compatibility)
     */
    getSocket(): Socket | null {
        return this.socket;
    }

    /**
     * Check if socket is connected
     */
    getIsConnected(): boolean {
        return this.isConnected;
    }

    /**
     * Initialize and connect the socket
     * Returns a promise that resolves when connected (or times out)
     */
    async connect(config?: Partial<SocketConfig>): Promise<void> {
        // If already connecting, return existing promise
        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        // If already connected, resolve immediately
        if (this.socket?.connected) {
            return Promise.resolve();
        }

        const finalConfig = { ...SocketService.DEFAULT_CONFIG, ...config };

        this.connectionPromise = new Promise<void>((resolve) => {
            // Create socket connection
            this.socket = io(finalConfig.url, {
                timeout: finalConfig.timeout,
                transports: finalConfig.transports as ("polling" | "websocket")[],
                upgrade: finalConfig.upgrade,
                forceNew: false,
                reconnection: finalConfig.reconnection,
                reconnectionDelay: finalConfig.reconnectionDelay,
                reconnectionDelayMax: finalConfig.reconnectionDelayMax,
                reconnectionAttempts: finalConfig.reconnectionAttempts,
                path: finalConfig.path
            });

            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    console.warn('⚠️ SocketService: Connection timeout - continuing without socket');
                    resolve();
                }
            }, 10000);

            this.socket.on('connect', () => {
                this.isConnected = true;
                this.notifyConnectionCallbacks(true);

                // Apply any pending listeners
                this.applyPendingListeners();

                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    console.log('✅ SocketService: Connected');
                    resolve();
                }
            });

            this.socket.on('disconnect', (reason: string) => {
                this.isConnected = false;
                this.notifyConnectionCallbacks(false);
                console.log('🔌 SocketService: Disconnected -', reason);
            });

            this.socket.on('connect_error', (error: Error) => {
                console.error('❌ SocketService: Connection error -', error.message);
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    resolve(); // Resolve anyway to not block app initialization
                }
            });
        });

        return this.connectionPromise;
    }

    /**
     * Subscribe to connection state changes
     */
    onConnectionChange(callback: ConnectionCallback): () => void {
        this.connectionCallbacks.add(callback);
        // Immediately notify of current state
        callback(this.isConnected);
        // Return unsubscribe function
        return () => this.connectionCallbacks.delete(callback);
    }

    /**
     * Register an event listener
     * If socket isn't connected yet, queues the listener for later
     */
    on(event: string, callback: SocketEventCallback): void {
        if (this.socket) {
            this.socket.on(event, callback);
        } else {
            // Queue for when socket connects
            if (!this.pendingListeners.has(event)) {
                this.pendingListeners.set(event, new Set());
            }
            this.pendingListeners.get(event)!.add(callback);
        }
    }

    /**
     * Remove an event listener
     */
    off(event: string, callback: SocketEventCallback): void {
        if (this.socket) {
            this.socket.off(event, callback);
        }
        // Also remove from pending if queued
        this.pendingListeners.get(event)?.delete(callback);
    }

    /**
     * Emit an event to the server
     */
    emit(event: string, ...args: unknown[]): void {
        if (this.socket?.connected) {
            this.socket.emit(event, ...args);
        } else {
            console.warn(`⚠️ SocketService: Cannot emit '${event}' - socket not connected`);
        }
    }

    /**
     * Disconnect the socket
     */
    disconnect(): void {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
            this.connectionPromise = null;
            this.notifyConnectionCallbacks(false);
        }
    }

    /**
     * Notify all connection callbacks
     */
    private notifyConnectionCallbacks(connected: boolean): void {
        for (const callback of this.connectionCallbacks) {
            try {
                callback(connected);
            } catch (error) {
                console.error('SocketService: Error in connection callback:', error);
            }
        }
    }

    /**
     * Apply pending listeners after socket connects
     */
    private applyPendingListeners(): void {
        if (!this.socket) return;

        for (const [event, callbacks] of this.pendingListeners) {
            for (const callback of callbacks) {
                this.socket.on(event, callback);
            }
        }
        this.pendingListeners.clear();
    }
}

// Export singleton getter for convenience
export const getSocketService = (): SocketService => SocketService.getInstance();
export default SocketService;
