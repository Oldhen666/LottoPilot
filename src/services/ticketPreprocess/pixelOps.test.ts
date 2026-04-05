import { adaptiveThreshold, claheGray, rgbaToGrayscale } from './pixelOps';

describe('pixelOps', () => {
  it('CLAHE and adaptive threshold preserve dimensions', () => {
    const w = 32;
    const h = 24;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 100;
      rgba[i + 1] = 120;
      rgba[i + 2] = 90;
      rgba[i + 3] = 255;
    }
    const gray = rgbaToGrayscale(rgba, w, h);
    const cl = claheGray(gray, w, h, 4, 2);
    expect(cl.length).toBe(w * h);
    const th = adaptiveThreshold(cl, w, h, 7, 3);
    expect(th.length).toBe(w * h);
  });
});
