
import { _decorator, Component, Node, resources, Prefab, instantiate, director, systemEvent, SystemEvent, Camera, geometry, EventTouch, Touch, PhysicsSystem, Collider, Vec3, Mat4, Quat, renderer, MeshRenderer, Color, Button } from 'cc';
import AgentManager from './AgentManager';
import AgentVo from './AgentVo';

import GridFlowField from './GridFlowField';
const { ccclass, property } = _decorator;
/**
 * Predefined variables
 * Name = FVOTest
 * DateTime = Wed Jan 28 2026 19:35:50 GMT+0800 (中国标准时间)
 * Author = kanon1109
 * FileBasename = FVOTest.ts
 * FileBasenameNoExtension = FVOTest
 * URL = db://assets/scripts/FVOTest.ts
 * ManualUrl = https://docs.cocos.com/creator/3.3/manual/zh/
 *
 */

@ccclass('FVOTest')
export class FVOTest extends Component {
    // [2]
    // @property
    // serializableDummy = 0;
    private gff: GridFlowField;

    @property(Camera)
    mainCamera: Camera;

    @property(Prefab)
    gridPrefab: Prefab;

    @property(Node)
    floor: Node;

    @property(Node)
    target: Node;

    @property(Button)
    addBtn: Button;

    private ray: geometry.Ray;

    private stageWidth: number;
    private stageHeight: number;

    private am: AgentManager;

    private enemyDataList = [
        { x: 2, y: 3, rotation: 30 },
        { x: 6, y: 4, rotation: 60 },
        { x: 3, y: 3, rotation: 180 },
        { x: 1, y: 2, rotation: 90 }
    ];

    private obstacleArray: { col: number; row: number }[] = [
        { col: 3, row: 5 }, { col: 7, row: 2 }, { col: 12, row: 9 }, { col: 1, row: 11 }, { col: 18, row: 4 },
        { col: 9, row: 7 }, { col: 5, row: 13 }, { col: 15, row: 0 }, { col: 8, row: 8 }, { col: 11, row: 6 },
        { col: 2, row: 1 }, { col: 17, row: 10 }, { col: 4, row: 14 }, { col: 10, row: 3 }, { col: 6, row: 12 },
        { col: 14, row: 5 }, { col: 0, row: 9 }, { col: 19, row: 7 }, { col: 13, row: 1 }, { col: 16, row: 8 },
        { col: 7, row: 14 }, { col: 9, row: 0 }, { col: 1, row: 4 }, { col: 5, row: 10 }, { col: 12, row: 13 },
        { col: 8, row: 2 }, { col: 18, row: 11 }, { col: 3, row: 6 }, { col: 11, row: 12 }, { col: 4, row: 0 },
        { col: 15, row: 9 }, { col: 2, row: 7 }, { col: 17, row: 3 }, { col: 10, row: 14 }, { col: 6, row: 5 },
        { col: 14, row: 1 }, { col: 0, row: 8 }, { col: 19, row: 10 }, { col: 13, row: 4 }, { col: 16, row: 13 },
        { col: 7, row: 6 }, { col: 9, row: 11 }, { col: 1, row: 1 }, { col: 5, row: 3 }, { col: 12, row: 12 },
        { col: 8, row: 14 }, { col: 18, row: 0 }, { col: 3, row: 9 }, { col: 11, row: 4 }, { col: 4, row: 7 }
    ];

    start() {

        // resources.load("prefab/role", Prefab, (err, prefab) => {
        //     let node: Node = instantiate(prefab);
        //     director.getScene().addChild(node);
        // });

        PhysicsSystem.instance.enable = true;

        this.stageWidth = 50;
        this.stageHeight = 50;

        this.floor.setScale(new Vec3(this.stageWidth, this.stageHeight, 1))

        this.gff = new GridFlowField();
        this.gff.calculateGridCount(this.stageWidth, this.stageHeight);
        // this.gff.addObstaclesByArray(this.obstacleArray);

        // this.gff.initGrids(this.node, this.gridPrefab);
        // this.gff.randomGenerateObstacles(10);
        this.gff.randomGenerateObstacles(50);
        // this.gff.initObstacleShapes();
        this.ray = new geometry.Ray();
        this.node.setPosition(new Vec3(-this.stageWidth / 2 + this.gff.GRID_SIZE / 2, 0, -this.stageWidth / 2 + this.gff.GRID_SIZE / 2));

        this.am = new AgentManager(this.gff);
        // this.initAgentVos();
        this.initObstacles();
        this.addAgentVos(Math.floor(Math.random() * 80) + 1);


        const mas: renderer.MaterialInstance = this.target.getComponent(MeshRenderer).materials[0];
        mas.setProperty("mainColor", new Color(10, 255, 0, 255));

        //点击
        systemEvent.on(SystemEvent.EventType.TOUCH_START, this.onTouchStart, this)

        this.addBtn.node.on(Button.EventType.CLICK, this.addBtnClickHandler, this);
    }


    private addBtnClickHandler(): void {
        this.addAgentVos(20);
    }

    private initObstacles(): void {
        this.obstacleArray = this.gff.getObstacleMapArr();
        for (let i: number = 0; i < this.obstacleArray.length; i++) {
            resources.load("prefab/ob", Prefab, (err, prefab) => {
                let data: { col: number, row: number } = this.obstacleArray[i];
                let pos: { x: number, y: number } = this.gff.getPosByGrid(data.col, data.row);
                let ob: Node = instantiate(prefab);
                ob.setPosition(new Vec3(pos.x, 0, pos.y))
                this.node.addChild(ob);
            });
        }
        this.am.update();
    }

    private initAgentVos(): void {
        for (let i: number = 0; i < this.enemyDataList.length; i++) {
            resources.load("prefab/role", Prefab, (err, prefab) => {
                let data: { x: number, y: number, rotation?: number } = this.enemyDataList[i];
                let role: Node = instantiate(prefab);
                role.setScale(.5, .5, .5);
                role.setPosition(new Vec3(data.x, 0, data.y))
                let r: number = role.getScale().x + .1;
                let aVo: AgentVo = this.am.addAgentVo(data.x, data.y, r);
                this.node.addChild(role);
                aVo.userData = role;
            });
        }
        this.am.update();
    }

    private addAgentVos(count: number): void {
        for (let i: number = 0; i < count; i++) {
            resources.load("prefab/role", Prefab, (err, prefab) => {
                let role: Node = instantiate(prefab);
                role.setScale(.5, .5, .5);
                role.setPosition(new Vec3(this.stageWidth / 2, 0, this.stageHeight / 2))
                let r: number = role.getScale().x + .1;
                let aVo: AgentVo = this.am.addAgentVo(this.stageWidth / 2, this.stageHeight / 2, r);
                this.node.addChild(role);
                aVo.userData = role;
            });
        }
        this.am.update();
    }

    onTouchStart(touch: Touch, event: EventTouch): void {
        if (!this.mainCamera) return;
        this.mainCamera.screenPointToRay(event.getLocationX(), event.getLocationY(), this.ray);
        if (PhysicsSystem.instance.raycast(this.ray)) {
            // 获取所有命中结果（按距离从近到远排序）
            const raycastResults = PhysicsSystem.instance.raycastResults;
            // 取第一个命中的物体（最近的3D物体）
            const hitResult = raycastResults[0];
            const hitPoint: Vec3 = hitResult.hitPoint;
            const hitObj: Node = hitResult.collider.node; // 命中的3D物体节点
            // 3. 获取两种核心坐标（按需使用）
            const hitLocalPos: Vec3 = new Vec3(); // 接收本地坐标的结果容器
            const invWorldMat: Mat4 = new Mat4(); // 声明世界矩阵的逆矩阵容器
            // 步骤1：计算击中节点世界矩阵的「逆矩阵」（核心：逆矩阵实现世界→本地转换）
            Mat4.invert(invWorldMat, hitObj.worldMatrix);
            // 步骤2：用逆矩阵转换世界坐标为节点本地坐标
            Vec3.transformMat4(hitLocalPos, hitPoint, invWorldMat);
            // console.log('hitLocalPos', hitLocalPos);
            // console.log('3D物体世界坐标（中心）：', objWorldPos);
            // console.log('射线命中点精确坐标（表面）：', hitPointWorldPos);
            let x: number = hitLocalPos.x * this.stageWidth + this.stageWidth / 2;
            let y: number = this.stageHeight / 2 - hitLocalPos.y * this.stageHeight;
            // console.log(x, y);
            // console.log(hitPoint);
            // console.log(hitLocalPos);
            let gridInfo: { col: number; row: number; } = this.gff.getGridByScreenPos(x, y);
            // 打印结果（直接用就行）
            if (!gridInfo) return;
            this.gff.calculateBFSDistanceField(gridInfo.col, gridInfo.row);
            let pos: { x: number, y: number } = this.gff.getPosByGrid(gridInfo.col, gridInfo.row);
            this.target.setPosition(new Vec3(pos.x - .5, .05, pos.y - .5));
            // this.gff.highlightTarget(gridInfo.col, gridInfo.row);
            // console.log(gridInfo);
            // console.log('点击命中3D物体：', hitObj.name);

            // 【拼图常用】给变量赋值，后续操作（比如移动拼图块）
            // this.targetPos = objWorldPos;
        }
    }

    /**
     * 更新agent显示对象
     */
    private updateViews(): void {
        if (!this.am.agents) return;
        for (let i: number = 0; i < this.am.agents.length; i++) {
            let aVo: AgentVo = this.am.agents[i];
            let agent: Node = aVo.userData;
            if (!agent) continue;
            agent.setPosition(new Vec3(aVo.x - .25, 0, aVo.y - .25))
            agent.setRotationFromEuler(0, 90 - aVo.rotation)
        }
    }

    update() {
        this.am.update();
        this.updateViews();
        if(this.am.agents.length < 500)
            this.addAgentVos(1);
    }
}
