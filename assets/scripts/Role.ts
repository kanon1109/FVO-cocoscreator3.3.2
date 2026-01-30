
import { _decorator, Component, Node, SkeletalAnimationComponent, SkeletalAnimation } from 'cc';
const { ccclass, property } = _decorator;

/**
 * Predefined variables
 * Name = Role
 * DateTime = Wed Jan 28 2026 20:05:17 GMT+0800 (中国标准时间)
 * Author = kanon1109
 * FileBasename = Role.ts
 * FileBasenameNoExtension = Role
 * URL = db://assets/scripts/Role.ts
 * ManualUrl = https://docs.cocos.com/creator/3.3/manual/zh/
 *
 */
 
@ccclass('Role')
export class Role extends Component {
    // [1]
    // dummy = '';

    // [2]
    // @property
    // serializableDummy = 0;

    start () {
        // [3]
        this.getComponent(SkeletalAnimation).play("run");
    }

    // update (deltaTime: number) {
    //     // [4]
    // }
}

/**
 * [1] Class member could be defined like this.
 * [2] Use `property` decorator if your want the member to be serializable.
 * [3] Your initialization goes here.
 * [4] Your update function goes here.
 *
 * Learn more about scripting: https://docs.cocos.com/creator/3.3/manual/zh/scripting/
 * Learn more about CCClass: https://docs.cocos.com/creator/3.3/manual/zh/scripting/ccclass.html
 * Learn more about life-cycle callbacks: https://docs.cocos.com/creator/3.3/manual/zh/scripting/life-cycle-callbacks.html
 */
