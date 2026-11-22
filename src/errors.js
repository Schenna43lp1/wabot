/** An error whose message may be shown to the user. */
export class UserError extends Error {
  /** @param {'invalid'|'gone'|'blocked'|'temporary'|'no_price'} [kind] */
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}
