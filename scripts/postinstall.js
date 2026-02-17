#!/usr/bin/env node
/**
 * Postinstall script - downloads the embedding model to ~/.codegraph/models
 * This runs after `npm install` or `npx @colbymchenry/codegraph`
 */
const { existsSync, mkdirSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');

const CODEGRAPH_DIR = join(homedir(), '.codegraph');
const MODELS_DIR = join(CODEGRAPH_DIR, 'models');
const MODEL_ID = 'nomic-ai/nomic-embed-text-v1.5';

async function downloadModel() {
  // Ensure directories exist
  if (!existsSync(CODEGRAPH_DIR)) {
    mkdirSync(CODEGRAPH_DIR, { recursive: true });
  }
  if (!existsSync(MODELS_DIR)) {
    mkdirSync(MODELS_DIR, { recursive: true });
  }

  // Check if model is already cached
  const modelCachePath = join(MODELS_DIR, MODEL_ID.replace('/', '/'));
  if (existsSync(modelCachePath)) {
    console.log('Embedding model already downloaded.');
    return;
  }

  console.log('Downloading embedding model (~130MB)...');
  console.log('This is a one-time download for semantic code search.\n');

  try {
    // Dynamic import for @xenova/transformers (ESM-only package)
    const { pipeline, env } = await import('@xenova/transformers');

    // Configure cache directory
    env.cacheDir = MODELS_DIR;

    // Download with progress
    await pipeline('feature-extraction', MODEL_ID, {
      progress_callback: (progress) => {
        if (progress.status === 'progress' && progress.file && progress.progress !== undefined) {
          const fileName = progress.file.split('/').pop();
          const percent = Math.round(progress.progress);
          process.stdout.write(`\rDownloading ${fileName}... ${percent}%   `);
        } else if (progress.status === 'done') {
          process.stdout.write('\n');
        }
      },
    });

    console.log('\nEmbedding model ready!');
  } catch (error) {
    // Don't fail the install if model download fails
    // User can still use codegraph without semantic search
    console.log('\nNote: Could not download embedding model.');
    console.log('Semantic search will download it on first use.');
    if (process.env.DEBUG) {
      console.error(error);
    }
  }
}

downloadModel().catch(() => {
  // Silent exit - don't break npm install
  process.exit(0);
});
