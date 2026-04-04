/**
 * Message Rate Limiter
 *
 * Prevents a single agent from flooding the server with too many messages
 * in a short period. Uses a sliding window algorithm.
 */

export interface RateLimiterConfig {
  maxMessages: number;
  windowMs: number;
}

export class MessageRateLimiter {
  private messageTimestamps = new Map<string, number[]>();
  private readonly maxMessages: number;
  private readonly windowMs: number;

  constructor(config: RateLimiterConfig) {
    this.maxMessages = config.maxMessages;
    this.windowMs = config.windowMs;
  }

  /**
   * Records a message from an agent and checks if they have exceeded the rate limit.
   *
   * @param agentId The ID of the agent sending the message.
   * @returns True if the agent is allowed to send the message, false otherwise.
   */
  public isAllowed(agentId: string): boolean {
    const now = Date.now();
    const timestamps = this.messageTimestamps.get(agentId) || [];

    // Remove timestamps older than the window
    const windowStart = now - this.windowMs;
    const recentTimestamps = timestamps.filter(ts => ts > windowStart);

    if (recentTimestamps.length >= this.maxMessages) {
      return false; // Limit exceeded
    }

    recentTimestamps.push(now);
    this.messageTimestamps.set(agentId, recentTimestamps);
    return true;
  }

  /**
   * Clears all tracking data (for testing).
   */
  public clear(): void {
    this.messageTimestamps.clear();
  }
}
