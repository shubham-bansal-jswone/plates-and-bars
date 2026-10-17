// Stand-in for @sentry/cli (see package.json). Plate & Bar uploads no source maps; any attempt to use the CLI fails loudly.
throw new Error('@sentry/cli is replaced by an empty stub: source-map upload is not supported in this project.');
