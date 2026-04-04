import { commonConstants } from '../constants/CommonConstants';

const CONTAINER_WIDTH = 55;

@Component
export struct SliderComponent {
  @LocalStorageLink('containerWidth') containerWidth: number = CONTAINER_WIDTH;

  build() {
    Slider({
      value: this.containerWidth,
      min: commonConstants.sliderMin,
      max: commonConstants.sliderMax
    })
      .width($r('app.float.slider_width'))
      .onChange((value: number) => {
        this.containerWidth = value;
      })
  }
}

