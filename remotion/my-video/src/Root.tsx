import "./index.css";
import { Composition } from "remotion";
import { CouponMaxxVideo } from "./CouponMaxxVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="CouponMaxxPromo"
        component={CouponMaxxVideo}
        durationInFrames={1470}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
