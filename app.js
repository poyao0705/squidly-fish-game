/**
 * @fileoverview Squidly Fish Game - Main Application Controller
 *
 * This module manages the game state, Firebase synchronization, and coordinates
 * between the logic (GameService), UI (GameUI), and Renderer (WebGLFishCursor).
 */

import { WebGLFishCursor } from "./index.js";
import GameService from "./game-service.js";
import { GameUI } from "./game-ui.js";

/**
 * FishGame - Main game controller class
 */
class FishGame {
  constructor() {
    // 1. Identity Management
    // ------------------------------------------------------------------------
    const sessionInfo =
      typeof session_info !== "undefined" ? session_info : null;
    const hasSessionInfo = sessionInfo != null;

    // Determine real host logic
    this._realIsHost = hasSessionInfo ? sessionInfo?.user === "host" : true;
    this._isSwapped = false;

    console.log("[FishGame] Initialized. Real IsHost:", this._realIsHost);

    // 2. Core Logic Service
    // ------------------------------------------------------------------------
    this._gameService = new GameService();

    // 3. UI Manager
    // ------------------------------------------------------------------------
    this._ui = new GameUI();

    // 4. State
    // ------------------------------------------------------------------------
    this.currentCursor = null;
    this.gridSize = 4;
    this.score = 0;
    this.isMultiplayerMode = false;
    this.firebaseStars = [];

    // Background music
    this._bgm = null;
    this.volume = 1.0;

    // SFX
    this._collectStarSfx = new Audio("./collect_star_effect.mp3");
    this._collectStarSfx.preload = "auto";

    // Per-cell star tracking
    this._starStates = new Map(); // "R_C" → boolean
    this._starListenersGridSize = null; // Grid size for which star listeners are active

    console.log("[FishGame] Controller ready.");
  }

  // ==========================================================================
  // Getters Delegates
  // ==========================================================================

  get isHost() {
    return this._isSwapped ? !this._realIsHost : this._realIsHost;
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  async init() {
    this._initializeHostDefaults();
    this._initFishCursor();
    this._setupEventListeners();
    this._setupFirebaseSubscriptions();
    this._setupSidebarIcons();

    // Initialize UI components
    this._ui.init(this.score);
    await this._initVolume();
    this._initBackgroundMusic();
  }

  async _initVolume() {
    const sessionInfo =
      typeof session_info !== "undefined" ? session_info : null;
    if (!sessionInfo) return;
    await SquidlyAPI.getSettings(
      `${sessionInfo.user}/volume/level`,
      this._updateVolume,
    );
    SquidlyAPI.addSettingsListener(
      `${sessionInfo.user}/volume/level`,
      this._updateVolume,
    );
  }

  _updateVolume = (value) => {
    const parsed = parseFloat(value) / 100;
    this.volume = isNaN(parsed) ? 1.0 : Math.min(1.0, Math.max(0.0, parsed));
    if (this._bgm) this._bgm.volume = this.volume;
    if (this._collectStarSfx) this._collectStarSfx.volume = this.volume;
  };

  _initBackgroundMusic() {
    if (this._bgm) return;

    this._bgm = new Audio("./fish_bgm.mp3");
    this._bgm.loop = true;
    this._bgm.volume = this.volume;
    this._bgm.preload = "auto";

    this._playBackgroundMusic();
  }

  _playBackgroundMusic() {
    if (!this._bgm) return;

    this._bgm.play().catch((error) => {
      console.warn("[FishGame] BGM autoplay failed.", error);
    });
  }

  _initFishCursor() {
    this.currentCursor = new WebGLFishCursor({
      isMultiplayerMode: this.isMultiplayerMode,
      isHost: this.isHost,
      onStarCollected: (starId) => this.onStarCollected(starId),
    });

    this.currentCursor.setStarGrid(this.gridSize);

    if (this.isMultiplayerMode) {
      this.currentCursor.syncStarsFromFirebase(this.firebaseStars);
    }
  }

  _initializeHostDefaults() {
    if (!this.isHost) return;

    const defaults = {
      gridSize: 4,
      score: 0,
      gameMode: "single-player",
      isSwapped: false,
    };

    Object.entries(defaults).forEach(([key, val]) => {
      SquidlyAPI.firebaseOnValue(
        key,
        (snapshot) => {
          if (snapshot === null || snapshot === undefined) {
            SquidlyAPI.firebaseSet(key, val);
          }
        },
        { onlyOnce: true },
      );
    });
  }

  // ==========================================================================
  // SETUP & EVENT LISTENERS
  // ==========================================================================

  _setupEventListeners() {
    // Local mouse

    // Squidly API
    SquidlyAPI.addCursorListener((data) => {
      let isParticipant = data.user.includes("participant");

      // Swap logic
      if (this._isSwapped) {
        isParticipant = !isParticipant;
      }

      this.updatePointerPosition(data.x, data.y, isParticipant);
    });

    SquidlyAPI.addSessionInfoListener((info) => {
      if (!this.isHost) return;

      const participantActive = info.participantActive === true;
      const targetMode = participantActive ? "multiplayer" : "single-player";

      if (
        (participantActive && !this.isMultiplayerMode) ||
        (!participantActive && this.isMultiplayerMode)
      ) {
        console.log(`[FishGame] Auto-switching to ${targetMode}`);
        SquidlyAPI.firebaseSet("gameMode", targetMode);
      }
    });
  }

  _setupSidebarIcons() {
    this._ui.setupGridControls({
      onGridIncrease: () => {
        const newSize = Math.min(4, this.gridSize + 1);
        if (newSize !== this.gridSize)
          SquidlyAPI.firebaseSet("gridSize", newSize);
      },
      onGridDecrease: () => {
        const newSize = Math.max(1, this.gridSize - 1);
        if (newSize !== this.gridSize)
          SquidlyAPI.firebaseSet("gridSize", newSize);
      },
    });

    // Initial Swap Button Check
    this._updateSwapButton();
  }

  // ==========================================================================
  // FIREBASE SUBSCRIPTIONS & SYNC
  // ==========================================================================

  _setupFirebaseSubscriptions() {
    // 1. Grid Size
    SquidlyAPI.firebaseOnValue("gridSize", (value) => {
      const validated = this._gameService.validateGridSize(value);
      if (this.gridSize !== validated) {
        // Clear stars from old grid before updating size
        if (this.isHost) {
          this._clearAllStarsInFirebase();
        }
        this.gridSize = this._gameService.setGridSize(validated);

        if (this.currentCursor) this.currentCursor.setStarGrid(validated);

        this._updateStarGridUI();
      }
      // Set up star listeners for current grid size (first time or on size change)
      if (this._starListenersGridSize !== this.gridSize) {
        this._setupStarListeners(this.gridSize);
      }
    });

    // 2. Score
    SquidlyAPI.firebaseOnValue("score", (value) => {
      const score = Number(value);
      if (Number.isFinite(score) && score >= 0) {
        this._gameService.setScore(score);
        this.score = score;
        this._ui.updateScore(score);
      }
    });

    // 4. Game Mode
    SquidlyAPI.firebaseOnValue("gameMode", (value) => {
      this._setGameMode(value);
    });

    // 5. Swap State
    SquidlyAPI.firebaseOnValue("isSwapped", (value) => {
      const isSwapped = value === true;

      if (this._isSwapped !== isSwapped) {
        this._isSwapped = isSwapped;
        console.log(
          `[FishGame] Swap state changed to: ${isSwapped}. Effective IsHost: ${this.isHost}`,
        );

        if (this.currentCursor) {
          this.currentCursor.setIsHost(this.isHost);
        }

        // Re-evaluate UI that depends on role
        this._updateStarGridUI();
      }
    });
  }

  /**
   * Sets up per-cell Firebase listeners for the star grid.
   * Each cell at (row, col) gets its own listener on "stars/R_C".
   * @param {number} gridSize - Grid dimension
   */
  _setupStarListeners(gridSize) {
    this._clearStarListeners();
    this._starListenersGridSize = gridSize;

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const key = `${row}_${col}`;
        SquidlyAPI.firebaseOnValue(`stars/${key}`, (value) => {
          this._onStarCellUpdate(row, col, value);
        });
      }
    }
  }

  /**
   * Clears star listener tracking and local star state.
   */
  _clearStarListeners() {
    this._starStates.clear();
    this._starListenersGridSize = null;
    this.firebaseStars = [];
  }

  /**
   * Handles a single star cell update from Firebase.
   * @param {number} row - Cell row
   * @param {number} col - Cell column
   * @param {*} value - Firebase value (true or null)
   */
  _onStarCellUpdate(row, col, value) {
    // Ignore updates for cells outside current grid
    if (row >= this.gridSize || col >= this.gridSize) return;

    const key = `${row}_${col}`;
    this._starStates.set(key, value === true);
    this._rebuildFirebaseStars();
  }

  /**
   * Rebuilds the firebaseStars array from per-cell state
   * and propagates to UI, renderer, and auto-regen logic.
   */
  _rebuildFirebaseStars() {
    const stars = [];
    for (const [key, exists] of this._starStates) {
      if (exists) {
        const [row, col] = key.split("_").map(Number);
        stars.push({
          id: this._gameService.createStarId(row, col),
          row,
          col,
        });
      }
    }

    this.firebaseStars = stars;
    this._gameService.setStars(stars);

    // Update UI
    this._ui.updateStarCellStates(stars);

    // Update Renderer
    if (this.currentCursor) {
      this.currentCursor.syncStarsFromFirebase(stars);
    }

    // Auto-Regen Logic (single-player only)
    if (
      this.isHost &&
      this._gameService.shouldRegenerateStars(stars, this.isMultiplayerMode)
    ) {
      setTimeout(() => {
        if (
          this._gameService.shouldRegenerateStars(
            this.firebaseStars,
            this.isMultiplayerMode,
          )
        ) {
          this._generateRandomStarsToFirebase();
        }
      }, 500);
    }
  }

  /**
   * Sets all currently-active star cells to null in Firebase.
   */
  _clearAllStarsInFirebase() {
    for (const [key, exists] of this._starStates) {
      if (exists) {
        SquidlyAPI.firebaseSet(`stars/${key}`, null);
      }
    }
  }

  // ==========================================================================
  // LOGIC & ACTIONS
  // ==========================================================================

  _setGameMode(mode) {
    const result = this._gameService.setGameMode(mode, this.isMultiplayerMode);
    if (!result.changed) return;

    this.isMultiplayerMode = result.isMultiplayer;
    this._gameService.isMultiplayerMode = result.isMultiplayer;
    console.log("[FishGame] Mode set to:", mode);

    if (result.shouldClearStars) {
      // Multiplayer: Clear stars
      this._clearAllStarsInFirebase();
      this._updateStarGridUI();
    } else if (result.shouldGenerateStars) {
      // Single Player: Reset swap, hide grid, generate stars
      if (this._isSwapped) {
        SquidlyAPI.firebaseSet("isSwapped", false);
        // Optimistic update for immediate logic
        this._isSwapped = false;
        if (this.currentCursor) this.currentCursor.setIsHost(this.isHost);
      }

      this._updateStarGridUI();
      if (this.isHost) {
        this._generateRandomStarsToFirebase();
      }
    }

    if (this.currentCursor && this.currentCursor.setMultiplayerMode) {
      this.currentCursor.setMultiplayerMode(result.isMultiplayer);
    }

    this._updateSwapButton();
  }

  _updateSwapButton() {
    this._ui.updateSwapButton(this.isMultiplayerMode, () => {
      this._toggleIdentitySwap();
    });
  }

  _toggleIdentitySwap() {
    if (!this.isMultiplayerMode) {
      console.warn("[FishGame] Cannot swap in single-player.");
      return;
    }
    SquidlyAPI.firebaseSet("isSwapped", !this._isSwapped);
  }

  _updateStarGridUI() {
    // Only show grid if Multiplayer AND Host
    const shouldShow = this.isMultiplayerMode && this.isHost;

    this._ui.updateStarControlGrid(
      shouldShow,
      this.gridSize,
      this.firebaseStars,
      (row, col) => this._onStarCellClick(row, col),
    );
  }

  _onStarCellClick(row, col) {
    const key = `${row}_${col}`;
    const currentlyExists = this._starStates.get(key) || false;
    SquidlyAPI.firebaseSet(`stars/${key}`, currentlyExists ? null : true);
  }

  _generateRandomStarsToFirebase() {
    if (!this.isHost) return;

    // Clear all existing stars
    this._clearAllStarsInFirebase();

    // Generate new random stars and set each individually
    const stars = this._gameService.generateRandomStars(this.gridSize);
    stars.forEach((star) => {
      SquidlyAPI.firebaseSet(`stars/${star.row}_${star.col}`, true);
    });
  }

  incrementScore() {
    const newScore = this._gameService.incrementScore();
    this.score = newScore;
    SquidlyAPI.firebaseSet("score", newScore);
    this._ui.updateScore(newScore);
  }

  onStarCollected(starId) {
    if (!starId) return;

    // Parse row/col from star ID format "star_row_col"
    const parts = starId.split("_");
    const row = Number(parts[1]);
    const col = Number(parts[2]);
    if (isNaN(row) || isNaN(col)) return;

    // Play collect SFX
    this._collectStarSfx.currentTime = 0;
    this._collectStarSfx.play().catch(() => {});

    // Remove star (listener will update local state)
    SquidlyAPI.firebaseSet(`stars/${row}_${col}`, null);

    // Increment score
    const newScore = this._gameService.incrementScore();
    this.score = newScore;
    SquidlyAPI.firebaseSet("score", newScore);
    this._ui.updateScore(newScore);

    console.log(`[FishGame] Star collected: ${starId}`);
  }

  updatePointerPosition(x, y, isParticipant = false) {
    if (!this.currentCursor || !this.currentCursor.inputManager) return;
    const pointerId = isParticipant ? "participant" : "host";
    this.currentCursor.inputManager.updatePointerPosition(x, y, pointerId);
  }
}

// Bootstrap
window.fishGame = new FishGame();
document.addEventListener("DOMContentLoaded", () => {
  window.fishGame.init();
});
