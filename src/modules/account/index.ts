// Public API of the account module: local accounts on this device, the sign-in gate, and whose data is in scope.
export { Gate } from "./Gate";
export { passwordError, scopedHome, scopedKey, type User } from "./local";
export { account, saveAccount, signOut } from "./session";
