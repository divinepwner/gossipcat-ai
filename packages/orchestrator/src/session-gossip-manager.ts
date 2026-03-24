import { SessionGossipEntry, SessionGossipSnapshot } from '@gossip/types';

/**
 * Manages the state of session gossip.
 */
export interface ISessionGossipManager {
  /**
   * Updates the gossip state with a new entry.
   * @param entry The session gossip entry.
   */
  update(entry: SessionGossipEntry): void;

  /**
   * Returns a snapshot of the current gossip state.
   * @returns A map of session ID to session state details.
   */
  getSnapshot(): SessionGossipSnapshot;
}
