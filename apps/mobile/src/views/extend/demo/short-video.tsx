import { AppPlayer } from '@commons/core/components';
import { VideoType } from '@commons/core/constants/data';
import { log, uuid } from '@commons/core/utils';
import { useMount } from 'ahooks';
import { produce } from 'immer';
import { FC, useState } from 'react';
import 'swiper/css';
import 'swiper/css/pagination';
import 'swiper/css/virtual';
import { Pagination, Virtual } from 'swiper/modules';
import { Swiper, SwiperSlide } from 'swiper/react';
import type { Swiper as SwiperClass } from 'swiper/types';
import styles from './short-video.module.scss';

const ShortVideo: FC = () => {
    const [currentIndex, setCurrentIndex] = useState<VideoType[]>([]);
    const [videoList, setVideoList] = useState<VideoType[]>([]);

    useMount(() => {
        log(`Index.useEffect...`);
        getData().then();
    });

    const getData = async () => {
        setVideoList(
            produce(videoList, (draftState: VideoType[]) => {
                for (let i = 0; i < 10; i++) {
                    draftState.push({
                        id: uuid(),
                        title: `Title ${uuid()}`,
                        src: 'https://vjs.zencdn.net/v/oceans.mp4',
                    } as VideoType);
                }
            }),
        );
    };

    const onSlideChange = (swiper: SwiperClass) => {
        console.log(`onSlideChange.activeIndex - ${swiper.activeIndex}`);
        if (swiper.isEnd) {
            getData().then();
        }
    };

    const onSwiper = (swiper: SwiperClass) => {
        console.log(`onSwiper.activeIndex - ${swiper.activeIndex}`);
    };

    return (
        <div className={styles.shortVideoContainer}>
            <Swiper
                className={styles.shortVideoSwiper}
                modules={[Pagination, Virtual]}
                direction={'vertical'}
                pagination={{
                    clickable: true,
                }}
                onSlideChange={onSlideChange}
                onSwiper={onSwiper}
            >
                {videoList.map((item: VideoType, index: number) => {
                    return (
                        <SwiperSlide key={item.id} className={styles.shortVideoSwiperSlide}>
                            {({ isActive, isNext, isPrev }) => {
                                console.log(isActive);
                                if (isActive || isNext || isPrev) {
                                    return (
                                        <AppPlayer
                                            options={{
                                                src: item.src,
                                                videoFillMode: 'fillWidth',
                                                cssFullscreen: {},
                                                fullscreen: {
                                                    useCssFullscreen: true,
                                                },
                                            }}
                                        ></AppPlayer>
                                    );
                                } else {
                                    return <div>{item.title}</div>;
                                }
                            }}
                        </SwiperSlide>
                    );
                })}
            </Swiper>
        </div>
    );
};

export default ShortVideo;
