/** A queue that runs async jobs one at a time, in order. Failures do not block later jobs. */
export function createSerialQueue() {
  let chain: Promise<unknown> = Promise.resolve();
  return function run<T>(job: () => Promise<T>): Promise<T> {
    const next = chain.then(job);
    chain = next.catch(() => {});
    return next;
  };
}

/**
 * Location processing and privacy-zone changes share this queue, so a zone added while
 * fixes are being processed can never let blocks inside it slip through.
 */
export const locationPipeline = createSerialQueue();
