/**
 * Minimal `process.env.NODE_ENV` declaration.
 *
 * This is a browser package, so pulling in `@types/node` for one property would
 * put Node's whole global surface (Buffer, __dirname, timers with Node return
 * types) into scope and let browser-invalid code typecheck clean. Bundlers
 * replace this expression at build time; declaring it is enough.
 */
declare const process: { env: { NODE_ENV?: string } };
