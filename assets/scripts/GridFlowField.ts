import { Color, color, instantiate, MeshRenderer, Node, Prefab, renderer, Vec3 } from "cc";

/**
 * 网格流场核心类（纯数据逻辑，障碍物由外部设置）
 * 核心职责：
 * 1. 维护网格/距离场数据
 * 2. BFS计算距离场
 * 3. 根据坐标获取流场向量方向
 * 4. 绘制流场（接收外部显示对象）
 * 障碍物管理：完全由外部通过方法传入，类内部仅存储
 */
export default class GridFlowField {

    // 单个网格的像素尺寸
    public readonly GRID_SIZE: number = 1;
    //----------private-----------
    private readonly GRID_COLOR: Color = new Color(105, 170, 253, 255);
    // 障碍物颜色（十六进制）
    private readonly OBSTACLE_COLOR: Color = new Color(255, 0, 0, 255);
    // 目标点颜色（十六进制）
    private readonly TARGET_COLOR: Color = new Color(10, 255, 0, 255);
    // 距离文本颜色（十六进制）
    // private readonly DISTANCE_TEXT_COLOR: number = 0xffffff;
    // 箭头颜色（十六进制）
    // private readonly ARROW_COLOR: number = 0x00ff00;
    // 箭头长度（像素）
    // private readonly ARROW_LENGTH: number = 12;
    // 舞台大小
    private _stageWidth: number;
    private _stageHeight: number;
    // 目标点全局x坐标
    private _targetX: number;
    // 目标点全局y坐标
    private _targetY: number;
    // 网格总列数（包含扩展区域）
    private _gridCols: number = 0;
    // 网格总行数（包含扩展区域）
    private _gridRows: number = 0;
    // 距离场网格 [col][row] = grid
    private distanceGrid: number[][];
    /** 目标点列索引 */
    private _targetCol: number = -1;
    /** 目标点行索引 */
    private _targetRow: number = -1;
    /** 障碍物映射表 {col_row: boolean} */
    private obstacleMap: { [key: string]: boolean } = {};
    // BFS最大距离值（表示不可达）
    private readonly BFS_MAX_DIST: number = 9999;
    /** 邻居检测方向数组（8方向） */
    private neighborDirs: Array<{ dx: number, dy: number }> = [
        { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
        { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
        { dx: -1, dy: 1 }, { dx: 0, dy: 1 }, { dx: 1, dy: 1 }
    ];
    /** 复用BFS队列，避免帧循环中重复创建数组 */
    private bfsQueue: Array<{ col: number, row: number, dist: number }>;
    // ===================== 可视化元素 =====================
    // 网格线绘制容器
    private gridCtn: Node;
    //网格预制体
    private gridPrefab: Prefab;
    //当前目标格子
    private curTargetGrid:Node;
    // 箭头图形容器
    // private arrowCtn: egret.Sprite;
    // 存放文本的容器
    // private textCtn: egret.Sprite;
    // 距离文本列表 [col][row] = TextField
    // private distanceTextArr: egret.TextField[][];
    //存放箭头列表 [col][row] = arrow
    // private arrowShapeArr: egret.Shape[][];
    /** 障碍物图形列表 */
    private obstacleShapeArr: Node[];
    // 浮点数对比容差阈值（可根据业务调整，建议0.001~0.01）
    // 含义：差值小于此值，认为两个浮点数相等
    private readonly OFFSET_EPSILON: number = 0.001;

    /**
     * 计算格子数量
     */
    public calculateGridCount(stageWidth: number, stageHeight: number): void {
        this._stageWidth = stageWidth;
        this._stageHeight = stageHeight;
        this._gridCols = Math.floor(stageWidth / this.GRID_SIZE);
        this._gridRows = Math.floor(stageHeight / this.GRID_SIZE);
        this.initDistanceGrid();
    }

    /** 
    * 初始化距离场数组（包含扩展网格）
    * 内存优化：复用数组，避免重复创建二维数组
    */
    private initDistanceGrid(): void {
        if (!this.distanceGrid) this.distanceGrid = new Array<number[]>(this._gridCols);
        for (let col: number = 0; col < this._gridCols; col++) {
            if (!this.distanceGrid[col] || this.distanceGrid[col].length !== this._gridRows) {
                this.distanceGrid[col] = new Array<number>(this._gridRows);
            }
            const colArr: number[] = this.distanceGrid[col];
            for (let row: number = 0; row < this._gridRows; row++) {
                colArr[row] = this.BFS_MAX_DIST;
            }
        }
    }

    /**
     * 通用方法：根据屏幕坐标获取对应的网格索引（支持地图偏移）
     * @param screenX 屏幕X坐标（比如e.stageX）
     * @param screenY 屏幕Y坐标（比如e.stageY）
     * @returns 网格信息 {col, row}
     */
    public getGridByScreenPos(screenX: number, screenY: number): { col: number; row: number; } {
        // 1. 核心：计算坐标时扣除地图偏移（适配地图移动）
        // 2. 计算场景内网格索引（屏幕可见区域的网格索引，从0开始）
        const col: number = Math.floor(screenX / this.GRID_SIZE);
        const row: number = Math.floor(screenY / this.GRID_SIZE);

        // if (this.isObstacle(col, row)) return null;
        // 3. 返回完整网格信息
        return {
            col,
            row,
        };
    }

    /**
     * 判断指定行列的格子是否为障碍
     * @param col 要判断的列索引（从0开始）
     * @param row 要判断的行索引（从0开始）
     * @returns boolean - true=是障碍，false=不是障碍/坐标无效
     */
    public isObstacle(col: number, row: number): boolean {
        if (!this.obstacleMap) return false;
        // 1. 边界校验：坐标超出网格范围，直接返回false（非障碍）
        if (this.isOutSide(col, row)) return false;
        // 2. 生成障碍映射表的唯一key（和添加障碍时的格式一致）
        const obstacleKey: string = `${col}_${row}`;
        // 3. 判断key是否存在于obstacleMap中，存在则为障碍
        const isObstacleFlag: boolean = !!this.obstacleMap[obstacleKey];
        return isObstacleFlag;
    }

    /**
     * 是否在边界外
     */
    public isOutSide(col: number, row: number): boolean {
        return (col < 0 || col >= this._gridCols ||
            row < 0 || row >= this._gridRows)
    }

    /**
     * 根据格子获取位置
     */
    public getPosByGrid(col: number, row: number): { x: number, y: number } {
        return { x: col * this.GRID_SIZE + this.GRID_SIZE / 2, y: row * this.GRID_SIZE + this.GRID_SIZE / 2 };
    }

    /** 
    * 绘制网格线（仅场景内）
    * 作用：在舞台可见区域绘制网格分割线
    */
    public initGrids(stage: Node, gridPrefab: Prefab): void {
        if (!stage) return;
        if (!this.gridCtn) {
            this.gridCtn = new Node();
            stage.addChild(this.gridCtn);
        }
        this.gridPrefab = gridPrefab;
        this.updateGrids();
    }

    public updateGrids(): void {
        if (!this.gridCtn) return;
        if (!this.gridPrefab) return;
        //整个网格区域的右下角X/Y坐标（含地图偏移）
        for (let col: number = 0; col < this._gridCols; col++) {
            const x: number = col * this.GRID_SIZE;
            for (let row: number = 0; row < this._gridRows; row++) {
                const y: number = row * this.GRID_SIZE;
                let node: Node = instantiate(this.gridPrefab);
                node.name = col + "_" + row;
                this.gridCtn.addChild(node);
                node.setPosition(new Vec3(x, 0, y))
                let mas: renderer.MaterialInstance = node.getComponent(MeshRenderer).materials[0];
                mas.setProperty("mainColor", this.GRID_COLOR);
            }
        }
    }

    /** 
     * BFS算法计算距离场 - 内存优化：复用队列
     * @param targetCol 目标点列索引
     * @param targetRow 目标点行索引
     */
    public calculateBFSDistanceField(targetCol: number, targetRow: number): void {
        if (this.isOutSide(targetCol, targetRow)) return;
        this._targetX = targetCol * this.GRID_SIZE + this.GRID_SIZE / 2;
        this._targetY = targetRow * this.GRID_SIZE + this.GRID_SIZE / 2;
        this._targetCol = targetCol;
        this._targetRow = targetRow;
        // console.log(targetCol, targetRow);
        this.initDistanceGrid();
        // 1. 初始化遍历用的openList（仅用于BFS消费-填充，push/shift）
        const openList: Array<{ col: number; row: number; dist: number }> = [];
        // 2. 初始化结果存储的bfsQueue（清空旧数据，只存最终有效格子）
        if (!this.bfsQueue) this.bfsQueue = [];
        this.bfsQueue.length = 0;
        // 3. 关闭列表：对象式，标记“已计算完最短距离并存入bfsQueue”的格子
        const closedList: { [key: string]: boolean } = {};
        // 4. 初始化目标格子（加入openList，距离设为0）
        const targetKey: string = `${targetCol}_${targetRow}`;
        // 前置校验：目标格子合法性
        openList.push({ col: targetCol, row: targetRow, dist: 0 });
        this.distanceGrid[targetCol][targetRow] = 0;
        // 5. 核心BFS遍历（openList负责push/shift，专门做遍历）
        while (openList.length > 0) {
            // 消费openList队首（shift只操作openList，不影响bfsQueue）
            const curr: { col: number; row: number; dist: number } = openList.shift()!;
            const currKey: string = `${curr.col}_${curr.row}`;

            // 跳过：已计算完并存入bfsQueue的格子（避免重复处理）
            if (closedList[currKey]) continue;
            // 跳过：当前记录的距离不是最优的（旧无效记录）
            if (curr.dist > this.distanceGrid[curr.col][curr.row]) continue;

            // 6. ✅ 核心：将当前格子存入bfsQueue（已计算出最短距离）
            this.bfsQueue.push({
                col: curr.col,
                row: curr.row,
                dist: this.distanceGrid[curr.col][curr.row] // 存入最终最短距离
            });
            // 标记为已处理，避免重复存入bfsQueue
            closedList[currKey] = true;
            // 7. 处理邻居（遍历8个方向，填充到openList）
            for (let j: number = 0; j < this.neighborDirs.length; j++) {
                const n: { dx: number, dy: number } = this.neighborDirs[j];
                const newCol: number = curr.col + n.dx;
                const newRow: number = curr.row + n.dy;
                const newKey: string = `${newCol}_${newRow}`;
                // 基础校验：边界、障碍物、对角线有效性
                if (this.isOutSide(newCol, newRow)) continue;
                // if (closedList[newKey]) continue;
                if (this.obstacleMap && this.obstacleMap[newKey]) continue;
                if (!this.isDiagonalMoveValid(curr.col, curr.row, n.dx, n.dy)) continue;

                // 计算移动成本和新距离
                const cost: number = (n.dx !== 0 && n.dy !== 0) ? Math.SQRT2 : 1;
                const newDist: number = curr.dist + cost;
                // 8. 仅当新距离更优时，将邻居加入openList继续遍历
                if (newDist < this.distanceGrid[newCol][newRow]) {
                    this.distanceGrid[newCol][newRow] = newDist;
                    openList.push({ col: newCol, row: newRow, dist: newDist });
                }
            }
            // 优化性能去掉了排序
            // openList.sort((a, b):number=>{
            //     return a.dist - b.dist;
            // })
        }
    }

    /** 
     * 对角线移动防穿透
     * 作用：防止敌人从两个相邻障碍物的对角线穿过
     * @param currCol 当前列索引
     * @param currRow 当前行索引
     * @param dx 列偏移
     * @param dy 行偏移
     * @returns 是否可以移动
     */
    private isDiagonalMoveValid(currCol: number, currRow: number, dx: number, dy: number): boolean {
        if (!this.obstacleMap) return true;
        if (dx === 0 || dy === 0) return true;
        const key1: string = `${currCol + dx}_${currRow}`;
        const key2: string = `${currCol}_${currRow + dy}`;
        const key3: string = `${currCol + dx}_${currRow + dy - 1}`;
        const key4: string = `${currCol + dx - 1}_${currRow + dy}`;
        return !this.obstacleMap[key1] && !this.obstacleMap[key2]
            && !this.obstacleMap[key3] && !this.obstacleMap[key4];
    }

    /** 
     * 高亮目标格子+更新BFS
     * 触发时机：点击网格时
     * @param col 场景内列索引
     * @param row 场景内行索引
     */
    public highlightTarget(col: number, row: number): void {
        if(this.isObstacle(col, row)) return;
        if(this.curTargetGrid)
        {
            let mas: renderer.MaterialInstance = this.curTargetGrid.getComponent(MeshRenderer).materials[0];
            mas.setProperty("mainColor", this.GRID_COLOR);
        }
        // 更新目标点显示
        let grid: Node = this.gridCtn.getChildByName(col + "_" + row);
        if (!grid) return
        let mas: renderer.MaterialInstance = grid.getComponent(MeshRenderer).materials[0];
        mas.setProperty("mainColor", this.TARGET_COLOR);
        this.curTargetGrid = grid;
    }

    /** 
     * 初始化距离文本（仅场景内）
     * 内存优化：批量回收，避免残留引用
     */
    // public initDistanceTexts(stage: egret.DisplayObjectContainer): void {
    //     if (!stage) return;
    //     if (!this.textCtn) {
    //         this.textCtn = new egret.Sprite();
    //         stage.addChild(this.textCtn);
    //     }
    //     this.clearDistanceText();
    //     if (this.distanceTextArr) this.distanceTextArr.length = 0;
    //     this.distanceTextArr = new Array<egret.TextField[]>(this._gridCols);
    //     for (let col: number = 0; col < this._gridCols; col++) {
    //         this.distanceTextArr[col] = new Array<egret.TextField>(this._gridRows);
    //         for (let row: number = 0; row < this._gridRows; row++) {
    //             // 仅初始化场景内的文本
    //             const text: egret.TextField = new egret.TextField();
    //             text.size = 12;
    //             text.textColor = this.DISTANCE_TEXT_COLOR;
    //             text.x = col * this.GRID_SIZE + 2;
    //             text.y = row * this.GRID_SIZE + 2;
    //             text.text = "";
    //             this.distanceTextArr[col][row] = text;
    //             this.textCtn.addChild(text);
    //         }
    //     }
    // }

    /** 
     * 更新距离文本显示
     * 作用：将距离场数值显示到对应网格
     */
    // public updateDistanceTexts(): void {
    //     if (!this.obstacleMap) return;
    //     for (let col: number = 0; col < this._gridCols; col++) {
    //         for (let row: number = 0; row < this._gridRows; row++) {
    //             const text: egret.TextField | null = this.distanceTextArr[col][row];
    //             if (!text) continue;
    //             const key: string = `${col}_${row}`;
    //             // 根据网格类型显示不同文本
    //             if (this.obstacleMap[key]) {
    //                 text.text = "X";
    //             } else if (col === this._targetCol && row === this._targetRow) {
    //                 text.text = "0";
    //             } else if (this.distanceGrid[col][row] === this.BFS_MAX_DIST) {
    //                 text.text = "∞";
    //             } else {
    //                 text.text = this.distanceGrid[col][row].toFixed(1);
    //             }
    //         }
    //     }
    // }

    /**
     * 清理箭头的图形
     */
    // private clearDistanceText(destroy: boolean = false): void {
    //     if (!this.distanceTextArr) return;
    //     for (let i: number = 0; i < this.distanceTextArr.length; i++) {
    //         const col: egret.TextField[] = this.distanceTextArr[i];
    //         // 跳过空列，避免后续循环报错
    //         if (!col) continue;
    //         // 内层循环：遍历列中的每个文本对象
    //         for (let j: number = 0; j < col.length; j++) {
    //             const text: egret.TextField = col[j];
    //             // 仅处理非空的文本对象
    //             if (text) text.text = ""; // 清空文本内容，释放字符串引用
    //             if (destroy && text.parent) text.parent.removeChild(text);
    //         }
    //     }
    // }

    /** 
     * 初始化箭头图形（仅场景内）
     * 内存优化：批量回收，避免残留引用
     */
    // public initArrowShapes(stage: egret.DisplayObjectContainer): void {
    //     if (!stage) return;
    //     if (!this.arrowCtn) {
    //         this.arrowCtn = new egret.Sprite();
    //         stage.addChild(this.arrowCtn);
    //     }
    //     this.clearArrowShape();
    //     if (this.arrowShapeArr) this.arrowShapeArr.length = 0;
    //     this.arrowShapeArr = new Array<egret.Shape[]>(this._gridCols);
    //     for (let col: number = 0; col < this._gridCols; col++) {
    //         this.arrowShapeArr[col] = new Array<egret.Shape>(this._gridRows);
    //         for (let row: number = 0; row < this._gridRows; row++) {
    //             // 仅初始化场景内的箭头
    //             const arrow: egret.Shape = new egret.Shape();
    //             arrow.x = col * this.GRID_SIZE + this.GRID_SIZE / 2;
    //             arrow.y = row * this.GRID_SIZE + this.GRID_SIZE / 2;
    //             this.arrowShapeArr[col][row] = arrow;
    //             this.arrowCtn.addChild(arrow);
    //         }
    //     }
    // }

    /**
     * 清理箭头的图形
     */
    // private clearArrowShape(destroy: boolean = false): void {
    //     if (!this.arrowShapeArr) return;
    //     for (let i: number = 0; i < this.arrowShapeArr.length; i++) {
    //         const col: egret.Shape[] = this.arrowShapeArr[i];
    //         if (!col) continue;
    //         for (let j: number = 0; j < col.length; j++) {
    //             const arrow: egret.Shape = col[j];
    //             if (arrow) arrow.graphics.clear(); // 清空绘图指令
    //             if (destroy && arrow.parent) arrow.parent.removeChild(arrow);
    //         }
    //     }
    // }

    /** 
     * 生成向量场箭头 (由于无法在第一次遍历邻居时就把所有最友的方向算出来，只有在全部格子便利完才能知道，所以只能再次遍历所有格子上的箭头寻找距离最短的格子)
     * 作用：根据距离场绘制每个网格的最优移动方向箭头
     */
    // public updateArrowsDir(): void {
    //     if (!this.obstacleMap) return;
    //     if (!this.distanceGrid) return;
    //     for (let col: number = 0; col < this._gridCols; col++) {
    //         for (let row: number = 0; row < this._gridRows; row++) {
    //             const arrow: egret.Shape = this.arrowShapeArr[col][row];
    //             if (!arrow) continue;
    //             arrow.graphics.clear();
    //             const key: string = `${col}_${row}`;
    //             // 跳过障碍物、目标点和不可达区域
    //             if (this.obstacleMap[key] || (col === this._targetCol && row === this._targetRow) ||
    //                 this.distanceGrid[col][row] === this.BFS_MAX_DIST) continue;
    //             let bestInfo: { dx: number, dy: number } = this.getBestMoveDirection(col, row);
    //             if (!bestInfo) continue;
    //             const bestDx: number = bestInfo.dx;
    //             const bestDy: number = bestInfo.dy;
    //             // 绘制箭头
    //             if (bestDx !== 0 || bestDy !== 0) {
    //                 const len: number = Math.sqrt(bestDx * bestDx + bestDy * bestDy);
    //                 const dirX: number = bestDx / len;
    //                 const dirY: number = bestDy / len;
    //                 arrow.graphics.lineStyle(1, this.ARROW_COLOR);
    //                 arrow.graphics.moveTo(0, 0);
    //                 arrow.graphics.lineTo(dirX * this.ARROW_LENGTH, dirY * this.ARROW_LENGTH);
    //                 // 绘制箭头头部
    //                 const angle: number = Math.atan2(dirY, dirX);
    //                 arrow.graphics.lineTo(
    //                     dirX * this.ARROW_LENGTH - 3 * Math.cos(angle - Math.PI / 6),
    //                     dirY * this.ARROW_LENGTH - 3 * Math.sin(angle - Math.PI / 6)
    //                 );
    //                 arrow.graphics.moveTo(dirX * this.ARROW_LENGTH, dirY * this.ARROW_LENGTH);
    //                 arrow.graphics.lineTo(
    //                     dirX * this.ARROW_LENGTH - 3 * Math.cos(angle + Math.PI / 6),
    //                     dirY * this.ARROW_LENGTH - 3 * Math.sin(angle + Math.PI / 6)
    //                 );
    //             }
    //         }
    //     }
    // }

    /** 
    * 获取最优移动方向（纯数值）
    * 核心逻辑：遍历8方向邻居，选择距离目标最近的可行方向
    * @param col 当前网格列索引
    * @param row 当前网格行索引
    */
    public getBestMoveDirection(col: number, row: number): { dx: number, dy: number } {
        if (this.isOutSide(col, row)) return null;
        let minDist: number = this.distanceGrid[col][row];
        let bestDx: number = 0;
        let bestDy: number = 0;
        // 内存优化：复用预定义的邻居数组
        const neighborLen: number = this.neighborDirs.length;
        for (let i: number = 0; i < neighborLen; i++) {
            const n: { dx: number, dy: number } = this.neighborDirs[i];
            const nCol: number = col + n.dx;
            const nRow: number = row + n.dy;
            const key: string = `${nCol}_${nRow}`;
            // 边界检查 + 障碍物检查 + 对角线有效性检查
            if (this.isOutSide(nCol, nRow)) continue;
            if (this.obstacleMap[key] || this.distanceGrid[nCol][nRow] === this.BFS_MAX_DIST) continue;
            if (!this.isDiagonalMoveValid(col, row, n.dx, n.dy)) continue;
            // 更新最优方向
            if (this.distanceGrid[nCol][nRow] < minDist) {
                minDist = this.distanceGrid[nCol][nRow];
                bestDx = n.dx;
                bestDy = n.dy;
            }
        }
        return { dx: bestDx, dy: bestDy };
    }

    /**
     * 手动添加障碍格子（通过障碍数组，for循环版本）
     * 核心逻辑：批量添加指定坐标的障碍，自动去重+边界校验，支持追加/覆盖模式
     * @param obstacles 障碍坐标数组（元素格式：{col: 列索引, row: 行索引}，索引从0开始）
     * @param isClearOld 是否清空原有障碍（默认false：追加模式；true：覆盖模式）
     * @returns void
     */
    public addObstaclesByArray(obstacles: { col: number; row: number }[], isClearOld: boolean = false): void {
        // 入参校验1：数组为null/空数组时直接返回，避免无效遍历
        if (!obstacles || obstacles.length === 0) return;
        // 模式选择：覆盖模式 - 清空原有所有障碍；追加模式 - 保留原有障碍
        if (isClearOld) this.obstacleMap = {};
        // for循环遍历障碍数组，逐个添加障碍（替代forEach，支持精准控制循环）
        for (let i: number = 0; i < obstacles.length; i++) {
            // 获取当前遍历的障碍坐标项，标注类型为可选（避免数组元素为null/undefined）
            const currObstacle: { col: number; row: number } = obstacles[i];
            if (!currObstacle) continue;
            // 边界校验：确保障碍坐标在网格有效范围内
            // 有效范围：列索引 0 ≤ col < gridCols；行索引 0 ≤ row < gridRows
            const isColValid: boolean = currObstacle.col >= 0 && currObstacle.col < this._gridCols;
            const isRowValid: boolean = currObstacle.row >= 0 && currObstacle.row < this._gridRows;
            if (!isColValid || !isRowValid) continue
            // 生成障碍格子的唯一标识（格式：列_行），用于去重和快速查找
            const obstacleKey: string = `${currObstacle.col}_${currObstacle.row}`;
            // 自动去重：重复坐标直接覆盖，不会重复添加到映射表
            this.obstacleMap[obstacleKey] = true;
        }
    }

    /** 
     * 随机生成障碍格子（仅场景内）
     * 内存优化：彻底清空数组，避免残留引用
     */
    public randomGenerateObstacles(obstaclesCount: number): void {
        if (obstaclesCount < 0) obstaclesCount = 0;
        if (!this.obstacleMap) this.obstacleMap = {};
        for (var key in this.obstacleMap) {
            if (this.obstacleMap.hasOwnProperty(key)) {
                delete this.obstacleMap[key];
            }
        }
        let count: number = 0;
        // 随机生成指定数量的障碍物（避免重复）
        while (count < obstaclesCount) {
            const col: number = Math.floor(Math.random() * this._gridCols);
            const row: number = Math.floor(Math.random() * this._gridRows);
            const key: string = `${col}_${row}`;
            if (this.obstacleMap[key]) continue;
            this.obstacleMap[key] = true;
            count++;
        }
    }

    /**
     * 根据障碍地图获取障碍行列数组
     * @returns 
     */
    public getObstacleMapArr():{col:number, row:number}[]
    {
        let mapArr:{col:number, row:number}[] = [];
        if(!this.obstacleMap) return mapArr;
        for (var key in this.obstacleMap) {
            if (this.obstacleMap.hasOwnProperty(key)) {
                let arr:string[] = key.split("_");
                let col:number = parseInt(arr[0]);
                let row:number = parseInt(arr[1]);
                mapArr.push({col:col, row:row})
            }
        }
        return mapArr;
    }

    /**
     * 绘制障碍
     */
    public initObstacleShapes(): void {
        // 遍历障碍物图形数组，清空所有图形的绘制内容
        this.clearObstacleShape();
        if (this.obstacleShapeArr) this.obstacleShapeArr.length = 0; // 清空数组，保留引用
        else this.obstacleShapeArr = [];
        for (var key in this.obstacleMap) {
            if (this.obstacleMap.hasOwnProperty(key)) {
                const grid: Node = this.gridCtn.getChildByName(key);
                const mas: renderer.MaterialInstance = grid.getComponent(MeshRenderer).materials[0];
                mas.setProperty("mainColor", this.OBSTACLE_COLOR);
                this.obstacleShapeArr.push(grid);
            }
        }
    }

    /**
     * 清理障碍的图形
     */
     private clearObstacleShape(): void {
        if (!this.obstacleShapeArr) return;
        for (let i: number = 0; i < this.obstacleShapeArr.length; i++) {
            const grid: Node = this.obstacleShapeArr[i];
            const mas: renderer.MaterialInstance = grid.getComponent(MeshRenderer).materials[0];
            mas.setProperty("mainColor", this.GRID_COLOR);
        }
    }

    /** 销毁所有资源 - 内存优化：彻底释放所有引用 */
    public destroy(): void {
        // 销毁文本和箭头
        // this.clearArrowShape(true);
        // this.clearDistanceText(true);
        // if (this.textCtn && this.textCtn.parent)
        //     this.textCtn.parent.removeChild(this.textCtn);
        // if (this.arrowCtn && this.arrowCtn.parent)
        //     this.arrowCtn.parent.removeChild(this.arrowCtn);
        // if (this.gridShape) this.gridShape.graphics.clear();
        if(this.gridCtn) 
        {
            this.gridCtn.removeAllChildren();
            this.gridCtn.destroyAllChildren();
            this.gridCtn.removeFromParent();
            this.gridCtn.destroy()
        }
        this.gridCtn = null;
        this.gridPrefab = null;
        if (this.obstacleShapeArr) this.obstacleShapeArr.length = 0;
        this.obstacleShapeArr = null;
        if (this.neighborDirs) this.neighborDirs.length = 0;
        this.neighborDirs = null;
        // 清空所有数据引用
        this.obstacleMap = null;
        if (this.distanceGrid) this.distanceGrid.length = 0;
        this.distanceGrid = null
    }

    /**
     * 目标点列索引
     */
    public get targetCol(): number {
        return this._targetCol;
    }

    /**
     * 目标点行索引
     */
    public get targetRow(): number {
        return this._targetRow;
    }

    /**
     * 目标点全局x坐标
     */
    public get targetX(): number {
        return this._targetX;
    }

    /**
     * 目标点全局y坐标
     */
    public get targetY(): number {
        return this._targetY;
    }

    /**
     * 网格总列数（包含扩展区域）
     */
    public get gridCols(): number {
        return this._gridCols;
    }

    /**
     * 网格总行数（包含扩展区域）
     */
    public get gridRows(): number {
        return this._gridRows;
    }

    /**
     * 舞台大小
     */
    public get stageWidth(): number {
        return this._stageWidth;
    }

    /**
     * 舞台大小
     */
    public get stageHeight(): number {
        return this._stageHeight;
    }
}
