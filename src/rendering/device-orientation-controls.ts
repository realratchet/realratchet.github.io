import {
    Euler,
    EventDispatcher,
    MathUtils,
    Quaternion,
    Vector3
} from 'three';

const _zee = new Vector3(0, 0, 1);
const _euler = new Euler();
const _q0 = new Quaternion();
const _q1 = new Quaternion(- Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // - PI/2 around the x-axis

const _changeEvent = { type: 'change' };

type Orientation = {
    alpha?: number;
    beta?: number;
    gamma?: number;
}

class DeviceOrientationControls extends EventDispatcher {
    public object: any;
    public enabled: boolean;
    public deviceOrientation: Orientation;
    public screenOrientation: number;
    public alphaOffset: number;
    public connect: () => void;
    public disconnect: () => void;
    public update: () => void;
    public dispose: () => void;

    constructor(object: THREE.Object3D, alphaOffset: number = 0, onGyroFound: Function = null) {

        super();

        if (window.isSecureContext === false) {

            console.error('THREE.DeviceOrientationControls: DeviceOrientationEvent is only available in secure contexts (https)');

        }

        const scope = this;

        const EPS = 0.000001;
        const lastQuaternion = new Quaternion();

        this.object = object;
        this.object.rotation.reorder('YXZ');

        this.enabled = true;

        this.deviceOrientation = {};
        this.screenOrientation = 0;

        this.alphaOffset = alphaOffset; // radians

        let gyroFoundCalled = false;

        const onDeviceOrientationChangeEvent = function (event: DeviceOrientationEvent) {

            scope.deviceOrientation = event;

            if (!gyroFoundCalled && event.alpha && event.beta && event.gamma) {
                gyroFoundCalled = true;
                onGyroFound();
            }

        };

        const onScreenOrientationChangeEvent = function () {

            scope.screenOrientation = screen.orientation.angle || 0;

            if (!gyroFoundCalled && screen.orientation.angle !== 0) {
                gyroFoundCalled = true;
                onGyroFound();
            }

        };

        // The angles alpha, beta and gamma form a set of intrinsic Tait-Bryan angles of type Z-X'-Y''

        const setObjectQuaternion = function (quaternion: THREE.Quaternion, alpha: number, beta: number, gamma: number, orient: number) {

            _euler.set(beta, alpha, - gamma, 'YXZ'); // 'ZXY' for the device, but 'YXZ' for us

            quaternion.setFromEuler(_euler); // orient the device

            quaternion.multiply(_q1); // camera looks out the back of the device, not the top

            quaternion.multiply(_q0.setFromAxisAngle(_zee, - orient)); // adjust for screen orientation

        };

        this.connect = function () {

            onScreenOrientationChangeEvent(); // run once on load

            // iOS 13+
            // @ts-ignore
            if (window.DeviceOrientationEvent !== undefined && typeof window.DeviceOrientationEvent.requestPermission === 'function') {

                // @ts-ignore
                window.DeviceOrientationEvent.requestPermission().then(function (response: string) {

                    if (response == 'granted') {

                        window.addEventListener('orientationchange', onScreenOrientationChangeEvent);
                        window.addEventListener('deviceorientation', onDeviceOrientationChangeEvent);

                    }

                }).catch(function (error: string) {

                    console.error('THREE.DeviceOrientationControls: Unable to use DeviceOrientation API:', error);

                });

            } else {

                window.addEventListener('orientationchange', onScreenOrientationChangeEvent);
                window.addEventListener('deviceorientation', onDeviceOrientationChangeEvent);

            }

            scope.enabled = true;

        };

        this.disconnect = function () {

            window.removeEventListener('orientationchange', onScreenOrientationChangeEvent);
            window.removeEventListener('deviceorientation', onDeviceOrientationChangeEvent);

            scope.enabled = false;

        };

        this.update = function () {

            if (scope.enabled === false) return;

            const device = scope.deviceOrientation;

            if (device) {

                const alpha = device.alpha ? MathUtils.degToRad(device.alpha) + scope.alphaOffset : 0; // Z

                const beta = device.beta ? MathUtils.degToRad(device.beta) : 0; // X'

                const gamma = device.gamma ? MathUtils.degToRad(device.gamma) : 0; // Y''

                const orient = scope.screenOrientation ? MathUtils.degToRad(scope.screenOrientation) : 0; // O

                setObjectQuaternion(scope.object.quaternion, alpha, beta, gamma, orient);

                if (8 * (1 - lastQuaternion.dot(scope.object.quaternion)) > EPS) {

                    lastQuaternion.copy(scope.object.quaternion);
                    scope.dispatchEvent(_changeEvent);

                }

            }

        };

        this.dispose = function () {

            scope.disconnect();

        };

        this.connect();

    }

}

export { DeviceOrientationControls };