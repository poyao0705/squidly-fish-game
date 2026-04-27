/**
 * @fileoverview Squidly Fish Game - Main Application Controller
 *
 * This module manages the game state, Firebase synchronization, and coordinates
 * between the logic (GameService), UI (GameUI), and Renderer (WebGLFishCursor).
 */

import { WebGLFishCursor } from "./index.js";
import GameService, { GAME_MODES, GAME_RULES } from "./game-service.js";
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
    this._initialSessionInfo = sessionInfo;

    // Determine real host logic
    this._realIsHost = hasSessionInfo ? sessionInfo?.user === "host" : true;
    this._isSwapped = false;
    this._participantActive = null;

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
    this.gridSize = GAME_RULES.GRID_MIN_SIZE;
    this.score = 0;
    this.isMultiplayerMode = false;
    this.firebaseStars = [];
    this.layoutStarsEarned = 0;
    this.layoutStarsRequired = GAME_RULES.REQUIRED_LAYOUT_CLEARS;
    this._layoutHadStars = false;

    // Background music
    this._bgm = null;
    this.volume = 1.0;

    // SFX
    this._collectStarSfx = new Audio("./collect_star_effect.mp3");
    this._collectStarSfx.preload = "auto";

    // Per-cell star tracking
    this._starStates = new Map(); // "R_C" → boolean
    this._starListenersGridSize = null; // Grid size for which star listeners are active
    this._pendingStarStates = null; // Staged multiplayer star selections before pressing Set Stars
    this._setStarsButtonKey = null;
    this._activeStarClearKeys = new Set();
    this._suppressNextLayoutClearProgress = false;

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
    this._syncGameModeFromParticipantPresence(this._initialSessionInfo);
    this._setupFirebaseSubscriptions();
    this._setupSidebarIcons();

    // Initialize UI components
    this._ui.init(this.score);
    this._syncLayoutProgressUI();
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
    if (this._bgm) this._bgm.volume = this.volume / 2;
    if (this._collectStarSfx) this._collectStarSfx.volume = this.volume / 2;
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
    if (!this._realIsHost) return;

    const initialParticipantActive =
      this._initialSessionInfo?.participantActive === true;

    const defaults = {
      gridSize: GAME_RULES.GRID_MIN_SIZE,
      score: 0,
      gameMode: initialParticipantActive
        ? GAME_MODES.MULTIPLAYER
        : GAME_MODES.SINGLE_PLAYER,
      isSwapped: false,
      layoutStarsEarned: 0,
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
      this._syncGameModeFromParticipantPresence(info);
    });
  }

  _syncGameModeFromParticipantPresence(info) {
    if (!this._realIsHost) return;

    const participantActive = info?.participantActive === true;
    const isInitialPresenceSync = this._participantActive === null;
    if (
      !isInitialPresenceSync &&
      this._participantActive === participantActive
    ) {
      return;
    }

    this._participantActive = participantActive;

    const nextMode = participantActive
      ? GAME_MODES.MULTIPLAYER
      : GAME_MODES.SINGLE_PLAYER;

    if (isInitialPresenceSync || participantActive !== this.isMultiplayerMode) {
      console.log(
        `[FishGame] Participant ${
          participantActive ? "joined" : "left"
        }. Automatically switching to ${nextMode}.`,
      );
      SquidlyAPI.firebaseSet("gameMode", nextMode);
    }
  }

  _setupSidebarIcons() {
    this._ui.setupGridControls({
      canIncreaseGrid: this._canIncreaseGrid(),
      onGridIncrease: () => this._advanceGrid(),
    });

    // Initial mode-dependent button checks
    this._updateSwapButton();
    this._updateSetStarsButton();
  }

  // ==========================================================================
  // FIREBASE SUBSCRIPTIONS & SYNC
  // ==========================================================================

  _setupFirebaseSubscriptions() {
    // 1. Grid Size
    SquidlyAPI.firebaseOnValue("gridSize", (value) => {
      const validated = this._gameService.validateGridSize(value);
      if (this.gridSize !== validated) {
        this._prepareGridSizeChange();
        this.gridSize = this._gameService.setGridSize(validated);

        if (this.currentCursor) this.currentCursor.setStarGrid(validated);

        this._updateStarGridUI();
      }
      // Set up star listeners for current grid size (first time or on size change)
      if (this._starListenersGridSize !== this.gridSize) {
        this._setupStarListeners(this.gridSize);
        this._scheduleSinglePlayerStarGeneration();
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

    // 3. Grid clear progress
    SquidlyAPI.firebaseOnValue("layoutStarsEarned", (value) => {
      this._setLayoutProgress(value, { syncFirebase: false });
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
        this._resetPendingStarSelection();
        this._updateStarGridUI();
        this._updateSetStarsButton();
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
    const parsedValue = this._parseStarCellValue(value);
    this._starStates.set(key, parsedValue);

    if (!parsedValue) {
      this._activeStarClearKeys.delete(key);
    }

    this._rebuildFirebaseStars();
  }

  _parseStarCellValue(value) {
    if (value === true) {
      return { offsetX: 0, offsetY: 0 };
    }

    if (typeof value === "string") {
      const [offsetX, offsetY] = value.split(",").map(Number);
      if (Number.isFinite(offsetX) && Number.isFinite(offsetY)) {
        return { offsetX, offsetY };
      }
    }

    if (value && typeof value === "object") {
      const { offsetX, offsetY } = value;
      return {
        offsetX: typeof offsetX === "number" ? offsetX : 0,
        offsetY: typeof offsetY === "number" ? offsetY : 0,
      };
    }

    return null;
  }

  /**
   * Rebuilds the firebaseStars array from per-cell state, then delegates
   * sync, progression, and auto-generation side effects.
   */
  _rebuildFirebaseStars() {
    const stars = this._starsFromCellState();
    const didClearLayout = this._layoutHadStars && stars.length === 0;

    this._syncStars(stars);
    this._handleLayoutClear(stars, didClearLayout);
    this._scheduleSinglePlayerStarGeneration(
      GAME_RULES.STAR_REGEN_DELAY_MS,
      stars,
    );
  }

  _starsFromCellState() {
    const stars = [];

    for (const [key, starData] of this._starStates) {
      if (!starData) continue;

      const [row, col] = key.split("_").map(Number);
      stars.push({
        id: this._gameService.createStarId(row, col),
        row,
        col,
        offsetX: typeof starData.offsetX === "number" ? starData.offsetX : 0,
        offsetY: typeof starData.offsetY === "number" ? starData.offsetY : 0,
      });
    }

    return stars;
  }

  _syncStars(stars) {
    this.firebaseStars = stars;
    this._gameService.setStars(stars);
    this._ui.updateStarCellStates(this._getStarGridDisplayStars());

    if (this.currentCursor) {
      this.currentCursor.syncStarsFromFirebase(stars);
    }
  }

  _handleLayoutClear(stars, didClearLayout) {
    if (stars.length > 0) {
      this._layoutHadStars = true;
      return;
    }

    if (!didClearLayout) return;

    this._layoutHadStars = false;
    if (
      this._suppressNextLayoutClearProgress ||
      this._activeStarClearKeys.size > 0
    ) {
      this._suppressNextLayoutClearProgress = false;
      return;
    }

    if (this.isHost) {
      // A grid progress star is earned after every star currently shown is collected.
      this._awardLayoutClearStar();
    }
  }

  /**
   * Sets all currently-active star cells to null in Firebase.
   */
  _clearAllStarsInFirebase() {
    const activeKeys = [];

    for (const [key, exists] of this._starStates) {
      if (exists) {
        activeKeys.push(key);
      }
    }

    if (activeKeys.length > 0) {
      this._suppressNextLayoutClearProgress = true;
    }

    activeKeys.forEach((key) => {
      SquidlyAPI.firebaseSet(`stars/${key}`, null);
    });
  }

  // ==========================================================================
  // LOGIC & ACTIONS
  // ==========================================================================

  _isLayoutComplete() {
    return this._gameService.isLayoutComplete(
      this.layoutStarsEarned,
      this.layoutStarsRequired,
    );
  }

  _canIncreaseGrid() {
    return this._gameService.canIncreaseGrid(
      this.layoutStarsEarned,
      this.gridSize,
      this.layoutStarsRequired,
    );
  }

  _syncLayoutProgressUI() {
    this._ui.updateLayoutProgress(
      this.layoutStarsEarned,
      this.layoutStarsRequired,
      this._canIncreaseGrid(),
    );
  }

  _setLayoutProgress(value, { syncFirebase = true } = {}) {
    this.layoutStarsEarned = this._gameService.normalizeLayoutProgress(
      value,
      this.layoutStarsRequired,
    );

    if (syncFirebase) {
      SquidlyAPI.firebaseSet("layoutStarsEarned", this.layoutStarsEarned);
    }

    this._syncLayoutProgressUI();
  }

  _resetLayoutProgress() {
    this._setLayoutProgress(0);
  }

  _prepareGridSizeChange() {
    this._resetPendingStarSelection();

    if (this.isHost) {
      this._clearAllStarsInFirebase();
      this._resetLayoutProgress();
    }

    this._layoutHadStars = false;
  }

  _advanceGrid() {
    if (!this._canIncreaseGrid()) return;

    const newSize = this._gameService.getNextGridSize(this.gridSize);
    if (newSize !== this.gridSize) {
      this._resetLayoutProgress();
      SquidlyAPI.firebaseSet("gridSize", newSize);
    }
  }

  _shouldGenerateSinglePlayerStars(stars = this.firebaseStars) {
    return this._gameService.shouldGenerateSinglePlayerStars({
      isHost: this.isHost,
      progress: this.layoutStarsEarned,
      stars,
      isMultiplayerMode: this.isMultiplayerMode,
      requiredClears: this.layoutStarsRequired,
    });
  }

  _scheduleSinglePlayerStarGeneration(
    delay = GAME_RULES.STARTUP_RETRY_DELAY_MS,
    stars = this.firebaseStars,
  ) {
    if (!this._shouldGenerateSinglePlayerStars(stars)) return;

    setTimeout(() => {
      if (this._shouldGenerateSinglePlayerStars()) {
        this._generateRandomStarsToFirebase();
      }
    }, delay);
  }

  _awardLayoutClearStar() {
    if (this._isLayoutComplete()) return;

    const newProgress = this._gameService.getNextLayoutProgress(
      this.layoutStarsEarned,
      this.layoutStarsRequired,
    );

    this._setLayoutProgress(newProgress);

    console.log(
      `[FishGame] Grid clear complete: ${newProgress}/${this.layoutStarsRequired}`,
    );
  }

  _setGameMode(mode) {
    const result = this._gameService.setGameMode(mode, this.isMultiplayerMode);
    if (!result.changed) {
      this._handleUnchangedGameMode();
      return;
    }

    this._applyGameModeState(mode, result);
    this._runGameModeSideEffects(result);
    this._syncRendererGameMode(result.isMultiplayer);
    this._updateSwapButton();
    this._updateSetStarsButton();
  }

  _handleUnchangedGameMode() {
    this._scheduleSinglePlayerStarGeneration();
  }

  _applyGameModeState(mode, result) {
    this.isMultiplayerMode = result.isMultiplayer;
    this._gameService.isMultiplayerMode = result.isMultiplayer;
    console.log("[FishGame] Mode set to:", mode);
  }

  _runGameModeSideEffects(result) {
    if (result.shouldClearStars) {
      this._enterMultiplayerMode();
    } else if (result.shouldGenerateStars) {
      this._enterSinglePlayerMode();
    }
  }

  _enterMultiplayerMode() {
    this._resetPendingStarSelection();
    this._clearAllStarsInFirebase();
    this._updateStarGridUI();
  }

  _enterSinglePlayerMode() {
    this._resetIdentitySwap();
    this._resetPendingStarSelection();
    this._updateStarGridUI();
    this._scheduleSinglePlayerStarGeneration();
  }

  _resetIdentitySwap() {
    if (!this._isSwapped) return;

    SquidlyAPI.firebaseSet("isSwapped", false);
    this._isSwapped = false;
    if (this.currentCursor) this.currentCursor.setIsHost(this.isHost);
  }

  _syncRendererGameMode(isMultiplayer) {
    if (this.currentCursor && this.currentCursor.setMultiplayerMode) {
      this.currentCursor.setMultiplayerMode(isMultiplayer);
    }
  }

  _updateSwapButton() {
    this._ui.updateSwapButton(this.isMultiplayerMode, () => {
      this._toggleIdentitySwap();
    });
  }

  _updateSetStarsButton() {
    if (this._setStarsButtonKey) {
      SquidlyAPI.removeIcon(this._setStarsButtonKey);
      this._setStarsButtonKey = null;
    }

    if (!this.isMultiplayerMode || !this.isHost) return;

    this._setStarsButtonKey = SquidlyAPI.setIcon(
      2,
      0,
      {
        symbol: "tick",
        displayValue: "Set Stars",
        type: "action",
      },
      () => this._setStagedStars(),
    );
  }

  _resetPendingStarSelection() {
    this._pendingStarStates = null;
  }

  _createPendingStarStateFromFirebase() {
    const pending = new Map();

    this.firebaseStars.forEach((star) => {
      pending.set(`${star.row}_${star.col}`, {
        offsetX: typeof star.offsetX === "number" ? star.offsetX : 0,
        offsetY: typeof star.offsetY === "number" ? star.offsetY : 0,
      });
    });

    return pending;
  }

  _getPendingStarStates() {
    if (!this._pendingStarStates) {
      this._pendingStarStates = this._createPendingStarStateFromFirebase();
    }

    return this._pendingStarStates;
  }

  _starsFromPendingState(pendingStates) {
    const stars = [];

    for (const [key, offset] of pendingStates) {
      const [row, col] = key.split("_").map(Number);
      stars.push({
        id: this._gameService.createStarId(row, col),
        row,
        col,
        offsetX: typeof offset.offsetX === "number" ? offset.offsetX : 0,
        offsetY: typeof offset.offsetY === "number" ? offset.offsetY : 0,
      });
    }

    return stars;
  }

  _getStarGridDisplayStars() {
    if (!this._pendingStarStates) return this.firebaseStars;
    return this._starsFromPendingState(this._pendingStarStates);
  }

  _setStagedStars() {
    if (!this.isMultiplayerMode || !this.isHost) return;

    const pendingStates =
      this._pendingStarStates ?? this._createPendingStarStateFromFirebase();
    const stars = this._starsFromPendingState(pendingStates);

    const targetKeys = new Set(stars.map((star) => `${star.row}_${star.col}`));
    const currentKeys = new Set(
      this.firebaseStars.map((star) => `${star.row}_${star.col}`),
    );
    const isRecommittingSameVisibleStars =
      stars.length === this.firebaseStars.length &&
      stars.every((star) => currentKeys.has(`${star.row}_${star.col}`));

    const keysToClear = [];
    for (const [key, exists] of this._starStates) {
      if (exists && !targetKeys.has(key)) {
        keysToClear.push(key);
      }
    }

    if (!isRecommittingSameVisibleStars) {
      this._layoutHadStars = false;
    }

    this._activeStarClearKeys = new Set(keysToClear);
    if (
      keysToClear.length > 0 &&
      keysToClear.length === this.firebaseStars.length
    ) {
      this._suppressNextLayoutClearProgress = true;
    }

    keysToClear.forEach((key) => {
      SquidlyAPI.firebaseSet(`stars/${key}`, null);
    });

    stars.forEach((star) => {
      SquidlyAPI.firebaseSet(
        `stars/${star.row}_${star.col}`,
        this._encodeStarOffset(star),
      );
    });

    this._pendingStarStates = null;
    this._updateStarGridUI();

    console.log(
      `[FishGame] Set ${stars.length} multiplayer star${
        stars.length === 1 ? "" : "s"
      }. Collect all visible stars to earn one grid progress star.`,
    );
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
      this._getStarGridDisplayStars(),
      (row, col) => this._onStarCellClick(row, col),
    );
  }

  _createRandomStarOffset() {
    return this._gameService.createRandomGridOffset();
  }

  _encodeStarOffset(offset) {
    return `${offset.offsetX},${offset.offsetY}`;
  }

  _onStarCellClick(row, col) {
    if (!this.isMultiplayerMode || !this.isHost) return;

    const key = `${row}_${col}`;
    const pendingStates = this._getPendingStarStates();

    if (pendingStates.has(key)) {
      pendingStates.delete(key);
    } else {
      pendingStates.set(key, this._createRandomStarOffset());
    }

    this._ui.updateStarCellStates(this._getStarGridDisplayStars());
  }

  _generateRandomStarsToFirebase() {
    if (!this.isHost) return;

    // Clear all existing stars
    this._clearAllStarsInFirebase();

    // Generate new random stars and set each individually
    const stars = this._gameService.generateRandomStars(this.gridSize);
    stars.forEach((star) => {
      const fallbackOffset = this._createRandomStarOffset();
      const offset = {
        offsetX:
          typeof star.offsetX === "number"
            ? star.offsetX
            : fallbackOffset.offsetX,
        offsetY:
          typeof star.offsetY === "number"
            ? star.offsetY
            : fallbackOffset.offsetY,
      };
      SquidlyAPI.firebaseSet(
        `stars/${star.row}_${star.col}`,
        this._encodeStarOffset(offset),
      );
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
