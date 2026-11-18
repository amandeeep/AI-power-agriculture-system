// Throw `new HttpError(404, 'Not found')` anywhere; the central error handler formats it.
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
