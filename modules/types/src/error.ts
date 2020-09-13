export class GenericError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.getErrorType();
  }

  private getErrorType(): string {
    return this.constructor.name.toUpperCase();
  }
}

export class Result<T, Y = any> {
  private value?: T;
  private error?: Y;

  public isError: boolean;

  constructor(error?: Y, value?: T) {
    if (error) {
      this.isError = true;
      this.error = error;
    } else {
      this.isError = false;
      this.value = value;
    }
  }

  public getValue(): T {
    if (this.isError) {
      throw new Error("Can't get the value of an error result. Use 'errorValue' instead.");
    }
    return this.value as T;
  }

  public getError(): Y | undefined {
    if (this.isError) {
      return this.error as Y;
    }
    return undefined;
  }

  public static fail<U, Y extends GenericError>(error: Y): Result<U, Y> {
    return new Result<U, Y>(error);
  }

  public static ok<T>(result: T): Result<T> {
    return new Result<T>(undefined, result);
  }
}