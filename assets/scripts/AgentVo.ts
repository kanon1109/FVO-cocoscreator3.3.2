/**
 * 敌人数据模型类（纯数值型，无任何对象属性）
 * 核心状态 + 计算临时值 均为独立数值，语义清晰、易继承
 * 所有数值仅存储状态，无业务逻辑，由外部逻辑（Game类）驱动更新
 */
 export default class AgentVo {
    public id: number;//唯一id
    // ===================== 核心状态（数值型） =====================
    // 位置/朝向
    /** 敌人世界坐标X轴位置（像素单位），与显示对象的x属性同步 */
    public x: number = 0;
    /** 敌人世界坐标Y轴位置（像素单位），与显示对象的y属性同步 */
    public y: number = 0;
    /** 敌人朝向角度（角度制，0=右，90=下，180=左，270=上），与显示对象的rotation属性同步 */
    public rotation: number = 0;

    // Agent 类里的属性
    /** 单个敌人最大移动速度（不同敌人可自定义） */
    public maxSpeed: number = .1;
    /** 单个敌人最大转向力（决定转向灵活度） */
    public maxForce: number = .01;
    /** 单个敌人减速距离（靠近目标时开始减速） */
    public slowDist: number = 2;
    /** 单个敌人碰撞半径（像素，不同体型敌人半径不同） */
    public radius: number = .5;
    // 碰撞阈值（也可直接用 enemyRadius，二选一）
    public collisionThreshold: number = this.radius;
    // 障碍物安全距离
    public obstacleSafeDist: number = this.radius;

    // 速度相关（核心运动状态）
    /** 当前帧计算的瞬时速度X分量（像素/帧），未经过平滑处理，用于力的直接叠加 */
    public currentVelocityX: number = 0;
    /** 当前帧计算的瞬时速度Y分量（像素/帧），未经过平滑处理，用于力的直接叠加 */
    public currentVelocityY: number = 0;
    /** 平滑后的速度X分量（像素/帧），用于最终移动计算，解决抖动问题 */
    public smoothVelocityX: number = 0;
    /** 平滑后的速度Y分量（像素/帧），用于最终移动计算，解决抖动问题 */
    public smoothVelocityY: number = 0;

    // 排斥力相关（核心行为状态）
    /** 目标单位排斥力X分量（像素/帧²），帧内计算的目标值，用于平滑插值 */
    public targetCancelForceX: number = 0;
    /** 目标单位排斥力Y分量（像素/帧²），帧内计算的目标值，用于平滑插值 */
    public targetCancelForceY: number = 0;
    /** 平滑后的单位排斥力X分量（像素/帧²），用于最终力的合并，避免排斥力突变 */
    public smoothCancelForceX: number = 0;
    /** 平滑后的单位排斥力Y分量（像素/帧²），用于最终力的合并，避免排斥力突变 */
    public smoothCancelForceY: number = 0;

    /** 目标障碍物排斥力X分量（像素/帧²），帧内计算的目标值，用于平滑插值 */
    public targetObstacleForceX: number = 0;
    /** 目标障碍物排斥力Y分量（像素/帧²），帧内计算的目标值，用于平滑插值 */
    public targetObstacleForceY: number = 0;
    /** 平滑后的障碍物排斥力X分量（像素/帧²），用于最终力的合并，避免避障抖动 */
    public smoothObstacleForceX: number = 0;
    /** 平滑后的障碍物排斥力Y分量（像素/帧²），用于最终力的合并，避免避障抖动 */
    public smoothObstacleForceY: number = 0;

    // ===================== 计算临时值（数值型，仅帧内复用） =====================
    /** 帧内临时存储的总合外力X分量（像素/帧²），每帧开始会重置为0 */
    public calcForceX: number = 0;
    /** 帧内临时存储的总合外力Y分量（像素/帧²），每帧开始会重置为0 */
    public calcForceY: number = 0;
    /** 帧内临时存储的移动方向X分量（归一化向量，范围[-1,1]），每帧开始会重置为0 */
    public calcDirX: number = 0;
    /** 帧内临时存储的移动方向Y分量（归一化向量，范围[-1,1]），每帧开始会重置为0 */
    public calcDirY: number = 0;
    /** 帧内临时存储的当前最大移动速度（像素/帧），根据到目标距离动态调整，每帧开始会重置为0 */
    public calcSpeed: number = 0;
    //用户数据
    public userData: any;
    /**
     * 重置核心状态（目标变更时调用）
     * 保留少量速度惯性（乘以0.1），避免目标切换时单位瞬间停住，提升移动手感
     */
    public reset(): void {
        // 重置速度：保留10%惯性，避免瞬间静止
        this.currentVelocityX *= 0.1;
        this.currentVelocityY *= 0.1;
        this.smoothVelocityX *= 0.1;
        this.smoothVelocityY *= 0.1;

        // 重置排斥力：清空所有目标力和平滑力，避免旧力影响新目标移动
        this.targetCancelForceX = 0;
        this.targetCancelForceY = 0;
        this.smoothCancelForceX = 0;
        this.smoothCancelForceY = 0;
        this.targetObstacleForceX = 0;
        this.targetObstacleForceY = 0;
        this.smoothObstacleForceX = 0;
        this.smoothObstacleForceY = 0;

        // 重置计算临时值
        this.resetCalcTemp();
    }

    /**
     * 仅重置计算临时值（帧循环开始时调用）
     * 每帧计算前清空临时变量，避免上一帧的计算残留影响当前帧结果
     */
    public resetCalcTemp(): void {
        this.calcForceX = 0;
        this.calcForceY = 0;
        this.calcDirX = 0;
        this.calcDirY = 0;
        this.calcSpeed = 0;
    }
}