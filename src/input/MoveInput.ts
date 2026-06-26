/**
 * Shared movement input written by the on-screen VirtualJoystick (UIScene) and
 * read by the Player (GameScene). A tiny module-level singleton so the two
 * scenes don't need to know about each other. The vector lies within the unit
 * disk: magnitude 0..1 gives analog speed; (0,0) means "no touch input".
 */
export const MoveInput = {
  x: 0,
  y: 0,
  active: false,

  set(x: number, y: number): void {
    MoveInput.x = x;
    MoveInput.y = y;
    MoveInput.active = x !== 0 || y !== 0;
  },

  clear(): void {
    MoveInput.x = 0;
    MoveInput.y = 0;
    MoveInput.active = false;
  },
};
