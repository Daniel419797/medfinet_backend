const { prisma } = require('../../utils/prisma');
const AnchorReceipt = require('./AnchorReceipt');

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [0, 10_000, 60_000];

class AnchorOutboxHandler {
  constructor(anchorService, logger) {
    this._anchor = anchorService;
    this._logger = logger;
  }

  get eventType() {
    return 'blockchain.anchor';
  }

  async handle(event) {
    if (!this._anchor.enabled) {
      this._logger.info('blockchain.anchor.skipped', { reason: 'disabled' });
      return;
    }

    const { eventCode, anchorId, tenantId } = event.payload;
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (RETRY_DELAYS_MS[attempt - 1] > 0) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
        }

        const receipt = await this._anchor.anchorEvent(eventCode, anchorId, tenantId);

        this._logger.info('blockchain.anchor.confirmed', {
          anchorId,
          eventCode,
          txId: receipt.txId,
          attempt,
        });

        return;
      } catch (err) {
        lastError = err;
        this._logger.warn('blockchain.anchor.retry', {
          anchorId,
          eventCode,
          attempt,
          error: err.message,
        });
      }
    }

    this._logger.error('blockchain.anchor.dead_letter', {
      anchorId,
      eventCode,
      error: lastError.message,
    });

    await this._saveDeadLetter(event, lastError.message);
    throw lastError;
  }

  async _saveDeadLetter(event, errorMessage) {
    await prisma.blockchainDeadLetter.create({
      data: {
        id: event.id,
        originalPayload: event.payload,
        error: errorMessage,
        retryCount: MAX_RETRIES,
        status: 'pending_review',
      },
    });
  }
}

module.exports = AnchorOutboxHandler;
