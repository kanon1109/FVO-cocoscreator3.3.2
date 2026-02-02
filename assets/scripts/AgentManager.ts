import AgentVo from "./AgentVo";
import GridFlowField from "./GridFlowField";

export default class AgentManager {
	/** agent数据对象列表 */
	private _agents: AgentVo[] = [];
	/** 敌人网格映射表 {col_row: [agentIndex1, agentIndex2...]} */
	private agentGridMap: { [key: string]: number[] } = {};
	/** 唯一id */
	private agentIdCounter: number = 0;
	/** 网格流场核心类 */
	private gff: GridFlowField;
	/** 复用临时agent id数组，避免频繁创建/销毁 */
	private nearbyIds: number[] = [];
	/** 复用临时映射表，用于去重 */
	private nearbyIdsMap: { [key: number]: boolean } = {};
	/** 消抖核心参数 */
	private readonly SMOOTH_FACTOR: number = 0.05;
	/** 最大排斥力上限 */
	private readonly REPULSE_FORCE_MAX: number = 0.8;
	/** 位置矫正衰减系数 */
	private readonly CORRECT_ATTENUATION: number = 0.5;
	/** 敌人核心配置参数 */
	private readonly FORCE_CANCEL_FACTOR: number = 1.5;
	/** 障碍物检测网格范围 */
	private readonly OBSTACLE_CHECK_GRID_RANGE: number = 1;
	/** 障碍物最大排斥力 */
	private readonly OBSTACLE_REPULSE_MAX: number = this.REPULSE_FORCE_MAX * 0.9;
	/** 流场力权重 */
	private readonly FLOW_FIELD_WEIGHT: number = 0.7;
	/** 分离力权重（敌人之间排斥） */
	private readonly SEPARATE_WEIGHT: number = 0.25;
	/** 对齐力权重（Boid算法） */
	private readonly ALIGN_WEIGHT: number = 0.15;
	/** 障碍物规避权重 */
	private readonly OBSTACLE_AVOID_WEIGHT: number = 0.25;
	/** 相邻障碍物排斥力倍增系数 */
	private readonly ADJACENT_OBSTACLE_FORCE_MULTIPLIER: number = 1.2;
	/** 障碍物矫正系数 */
	private readonly OBSTACLE_CORRECT_FACTOR: number = 0.15;

	public constructor(gff: GridFlowField) {
		this.gff = gff;
	}

	/**
	 * 创建agent数据
	 */
	public addAgentVo(x: number, y: number, radius: number, rotation: number = 0): AgentVo {
		const aVo: AgentVo = new AgentVo();
		aVo.x = x;
		aVo.y = y;
		aVo.rotation = rotation;
		aVo.id = ++this.agentIdCounter;
		aVo.radius = radius;
		this._agents.push(aVo);
		return aVo;
	}

	/**
	 * 批量添加agent
	 */
	public addAgentVos(list: { x: number, y: number, radius: number, rotation?: number }[]): void {
		if (!list) return;
		for (let i: number = 0; i < list.length; i++) {
			let data: { x: number, y: number, radius: number, rotation?: number } = list[i];
			let aVo: AgentVo = this.addAgentVo(data.x, data.y, data.radius, data.rotation);
		}
	}

	/**
	 * 循环整个显示对象
	 */
	public update(): void {
		this.updateAgentGridMap();
		this.updateAgents();
	}

	/** 
	 * 更新敌人网格映射
	 * 作用：将敌人分配到对应网格，优化邻居查找效率
	 */
	private updateAgentGridMap(): void {
		if (!this._agents) return;
		/** 内存优化：清空映射表，避免残留引用 */
		for (const key in this.agentGridMap) {
			if (this.agentGridMap.hasOwnProperty(key)) {
				this.agentGridMap[key].length = 0; /** 清空数组 */
				delete this.agentGridMap[key]; /** 删除键 */
			}
		}
		/** 遍历所有敌人更新映射 */
		const agentLen: number = this._agents.length;
		for (let index: number = 0; index < agentLen; index++) {
			const aVo: AgentVo = this._agents[index];
			let gridInfo: { col: number; row: number; } = this.gff.getGridByScreenPos(aVo.x, aVo.y);
			if (!gridInfo) continue;
			const col: number = gridInfo.col;
			const row: number = gridInfo.row;
			const key: string = `${col}_${row}`;
			if (!this.agentGridMap[key]) this.agentGridMap[key] = [];
			this.agentGridMap[key].push(aVo.id);
		}
	}

	/**
	 * 更新所有agent
	 */
	private updateAgents(): void {
		if (!this._agents) return;
		const agentLen: number = this._agents.length;
		for (let i: number = 0; i < agentLen; i++) {
			const aVo: AgentVo = this._agents[i];
			/** console.log(aVo.x, aVo.y); */
			aVo.resetCalcTemp();
			/** 1. 计算当前敌人的网格位置（含边界约束） */
			let gridInfo: { col: number; row: number; } = this.gff.getGridByScreenPos(aVo.x, aVo.y);
			if (!gridInfo) continue;
			let currCol: number = gridInfo.col;
			let currRow: number = gridInfo.row;
			aVo.calcDirX = aVo.calcDirY = 0;
			/** 2. 计算最优移动目标坐标 */
			let bestInfo: { dx: number, dy: number } = this.gff.getBestMoveDirection(currCol, currRow);
			if (bestInfo) {
				aVo.calcDirX = bestInfo.dx;
				aVo.calcDirY = bestInfo.dy;
			}
			/** 网格转世界坐标（目标点） */
			const optimalTargetX: number = (currCol + aVo.calcDirX) * this.gff.GRID_SIZE + this.gff.GRID_SIZE / 2;
			const optimalTargetY: number = (currRow + aVo.calcDirY) * this.gff.GRID_SIZE + this.gff.GRID_SIZE / 2;
			/** 3. 计算缓速后的移动速度 */
			this.calculateAgentSpeed(aVo);
			/** 16. 计算"寻路力"（朝向最优目标的吸引力） */
			/** 作用：给敌人一个朝向optimalTargetX/Y的力，让敌人往目标移动（类似磁铁吸引） */
			this.seek(aVo, optimalTargetX, optimalTargetY);
			/** 17. 计算"敌人排斥力"（精准版）：避免当前敌人和其他敌人重叠 */
			/** 作用：检测周围敌人，计算一个"推开"的力，防止敌人挤在一起 */
			this.calculatePreciseCancelForce(aVo);
			/** 18. 平滑敌人排斥力：让排斥力变化更平缓，避免突然弹开（提升手感） */
			this.smoothLerpCancelForce(aVo, this.SMOOTH_FACTOR);
			/** 19. 计算"障碍物排斥力"：避免敌人穿墙/撞障碍物 */
			/** 作用：检测周围障碍物，计算一个"远离障碍物"的力 */
			this.calculateObstacleRepulseForce(aVo);
			/** 20. 平滑障碍物排斥力（平滑系数略大，让避障更柔和） */
			this.smoothLerpObstacleForce(aVo, this.SMOOTH_FACTOR * 1.1);
			/** 21. 合并所有力（寻路力+敌人排斥力+障碍物排斥力），并应用到敌人的速度/位置上 */
			/** 核心：把多种力整合，最终算出敌人本帧该移动的增量 */
			this.mergeAndApplyForce(aVo);
			/** 22. 速度方向约束：进一步限制速度方向，避免合并力后出现"穿墙/重叠"的无效移动 */
			this.limitVelocityToAvoidOverlapAndObstacle(aVo);
			/** 23. 硬约束-位置矫正（平滑版）：如果还是和其他敌人重叠，强制微调位置（但平滑移动，不突兀） */
			this.correctOverlapPositionSmooth(aVo);
			/** 24. 硬约束-障碍物位置矫正：如果和障碍物重叠，强制微调位置避障 */
			this.correctObstacleOverlapSmooth(aVo);
			/** 场景边界约束 */
			this.limitAgentToSceneBounds(aVo);
			/** 封装平滑转向逻辑：计算敌人朝向全局目标的平滑旋转角度 */
			this.calculateSmoothRotation(aVo);
		}
	}

	/**
	 * 子封装：计算敌人缓速后的速度
	 * @param aVo 敌人数据载体
	 */
	private calculateAgentSpeed(aVo: AgentVo): void {
		if (!aVo) return;
		if (this.isTargetInvalid()) return;
		const dx: number = this.gff.targetX - aVo.x;
		const dy: number = this.gff.targetY - aVo.y;
		const distToGlobalTarget: number = Math.sqrt(dx * dx + dy * dy);
		/** 初始最大速度 */
		aVo.calcSpeed = aVo.maxSpeed;
		/** 缓速逻辑 */
		if (distToGlobalTarget < aVo.slowDist)
			aVo.calcSpeed = aVo.maxSpeed * (distToGlobalTarget / aVo.slowDist);
	}

	/** 
	 * Seek靠近行为（纯数值）
	 * @param aVo 敌人数据对象
	 * @param targetX 目标点X坐标
	 * @param targetY 目标点Y坐标
	 */
	private seek(aVo: AgentVo, targetX: number, targetY: number): void {
		if (!aVo) return;
		aVo.calcDirX = targetX - aVo.x;
		aVo.calcDirY = targetY - aVo.y;
		const length: number = Math.sqrt(aVo.calcDirX * aVo.calcDirX + aVo.calcDirY * aVo.calcDirY);
		if (length > 0) {
			aVo.calcDirX /= length;
			aVo.calcDirY /= length;
		}
		aVo.calcDirX *= aVo.maxSpeed;
		aVo.calcDirY *= aVo.maxSpeed;
		aVo.calcForceX = aVo.calcDirX - aVo.smoothVelocityX;
		aVo.calcForceY = aVo.calcDirY - aVo.smoothVelocityY;
		const forceLength: number = Math.sqrt(aVo.calcForceX * aVo.calcForceX + aVo.calcForceY * aVo.calcForceY);
		if (forceLength > aVo.maxForce) {
			const ratio: number = aVo.maxForce / forceLength;
			aVo.calcForceX *= ratio;
			aVo.calcForceY *= ratio;
		}
	}


	/** 
	 * 计算敌人排斥抵消力
	 * 作用：避免敌人之间重叠
	 * @param aVo 敌人数据对象
	 * @param id 敌人id
	 */
	private calculatePreciseCancelForce(aVo: AgentVo): void {
		if (!aVo) return;
		let cancelX: number = 0;
		let cancelY: number = 0;
		let totalWeight: number = 0;
		const agentX: number = aVo.x;
		const agentY: number = aVo.y;
		/** 获取当前网格及附近敌人 */
		const col: number = Math.floor(agentX / this.gff.GRID_SIZE);
		const row: number = Math.floor(agentY / this.gff.GRID_SIZE);
		const nearbyIds: number[] = this.getNearbyAgentIds(col, row);

		const nearbyLen: number = nearbyIds.length;
		for (let i: number = 0; i < nearbyLen; i++) {
			const otherId: number = nearbyIds[i];
			if (aVo.id === otherId) continue;
			const otherVo: AgentVo = this.getAgentVoById(otherId);
			let dx: number = otherVo.x - agentX;
			let dy: number = otherVo.y - agentY;
			let distance: number = Math.sqrt(dx * dx + dy * dy);
			/** 仅处理碰撞阈值内的敌人 */
			if (distance < otherVo.collisionThreshold && distance > 0) {
				const overlapDirX: number = dx / distance;
				const overlapDirY: number = dy / distance;
				let flowComponent: number = aVo.calcForceX * overlapDirX + aVo.calcForceY * overlapDirY;
				/** 仅处理同向的排斥（避免反向力） */
				if (flowComponent > 0) {
					const weight: number = 1 / distance;
					totalWeight += weight;
					cancelX += overlapDirX * flowComponent * this.FORCE_CANCEL_FACTOR * weight;
					cancelY += overlapDirY * flowComponent * this.FORCE_CANCEL_FACTOR * weight;
				}
			}
		}

		/** 归一化排斥力 */
		if (totalWeight > 0) {
			cancelX /= totalWeight;
			cancelY /= totalWeight;
		}

		/** 限制最大排斥力 */
		const cancelLength: number = Math.sqrt(cancelX * cancelX + cancelY * cancelY);
		if (cancelLength > this.REPULSE_FORCE_MAX) {
			const ratio: number = this.REPULSE_FORCE_MAX / cancelLength;
			cancelX *= ratio;
			cancelY *= ratio;
		}

		aVo.targetCancelForceX = cancelX;
		aVo.targetCancelForceY = cancelY;
	}

	/** 
	 * 获取附近网格的敌人id - 内存优化：复用临时数组
	 * @param col 当前列索引
	 * @param row 当前行索引
	 * @returns 附近敌人id数组
	 */
	private getNearbyAgentIds(col: number, row: number): number[] {
		const neighbors: number[][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
		/** 内存优化：清空复用数组，避免创建新数组 */
		this.nearbyIds.length = 0;
		/** 清空临时映射表 */
		for (const key in this.nearbyIdsMap) {
			delete this.nearbyIdsMap[key];
		}
		/** 自身网格 */
		const selfKey: string = `${col}_${row}`;
		if (this.agentGridMap[selfKey]) {
			const selfIds: number[] = this.agentGridMap[selfKey];
			const selfLen: number = selfIds.length;
			for (let i: number = 0; i < selfLen; i++) {
				const id: number = selfIds[i];
				if (!this.nearbyIdsMap[id]) {
					this.nearbyIdsMap[id] = true;
					this.nearbyIds.push(id);
				}
			}
		}
		/** 相邻网格 */
		const neighborLen: number = neighbors.length;
		for (let i: number = 0; i < neighborLen; i++) {
			const [dx, dy] = neighbors[i];
			const key: string = `${col + dx}_${row + dy}`;
			if (this.agentGridMap[key]) {
				const neighborIds: number[] = this.agentGridMap[key];
				const neighborIdsLen: number = neighborIds.length;
				for (let j: number = 0; j < neighborIdsLen; j++) {
					const id: number = neighborIds[j];
					if (!this.nearbyIdsMap[id]) {
						this.nearbyIdsMap[id] = true;
						this.nearbyIds.push(id);
					}
				}
			}
		}
		return this.nearbyIds;
	}

	/** 
	 * 计算障碍物排斥力
	 * 作用：避免敌人碰撞障碍物
	 * @param aVo 敌人数据对象
	 */
	private calculateObstacleRepulseForce(aVo: AgentVo): void {
		if (!aVo) return;
		let repulseX: number = 0;
		let repulseY: number = 0;
		const agentX: number = aVo.x;
		const agentY: number = aVo.y;
		const gridSize: number = this.gff.GRID_SIZE;
		/** 转换为场景网格坐标 */
		const sceneCol: number = Math.floor(agentX / gridSize);
		const sceneRow: number = Math.floor(agentY / gridSize);
		/** 检测附近网格的障碍物 */
		for (let dCol: number = -this.OBSTACLE_CHECK_GRID_RANGE; dCol <= this.OBSTACLE_CHECK_GRID_RANGE; dCol++) {
			for (let dRow: number = -this.OBSTACLE_CHECK_GRID_RANGE; dRow <= this.OBSTACLE_CHECK_GRID_RANGE; dRow++) {
				const checkCol: number = sceneCol + dCol;
				const checkRow: number = sceneRow + dRow;
				/** 边界检查 + 障碍物检查 */
				if (this.gff.isOutSide(checkCol, checkRow) ||
					!this.gff.isObstacle(checkCol, checkRow)) {
					continue;
				}
				/** 计算障碍物边界 */
				const obsLeft: number = checkCol * gridSize;
				const obsRight: number = checkCol * gridSize + gridSize;
				const obsTop: number = checkRow * gridSize;
				const obsBottom: number = checkRow * gridSize + gridSize;
				/** 计算敌人到障碍物的最近点 */
				let closestX: number = Math.max(obsLeft, Math.min(agentX, obsRight));
				let closestY: number = Math.max(obsTop, Math.min(agentY, obsBottom));
				let dx: number = agentX - closestX;
				let dy: number = agentY - closestY;
				const distance: number = Math.sqrt(dx * dx + dy * dy);
				/** 仅处理安全距离内的障碍物 */
				if (distance > aVo.obstacleSafeDist) continue;
				/** 检测相邻障碍物（增强排斥力） */
				let hasAdjacentObstacle: boolean = false;
				/** 核心修改：将字符串数组改为数值型二维数组 [col, row] */
				const adjGrid: number[][] = [
					[checkCol + 1, checkRow],   /** 右邻网格 */
					[checkCol - 1, checkRow],   /** 左邻网格 */
					[checkCol, checkRow + 1],   /** 下邻网格 */
					[checkCol, checkRow - 1]    /** 上邻网格 */
				];
				const adjLen: number = adjGrid.length;
				for (let i: number = 0; i < adjLen; i++) {
					let adjCol: number = adjGrid[i][0];
					let adjRow: number = adjGrid[i][1];
					/** 调用isObstacle，传入数值型的列和行（无需字符串转换） */
					if (this.gff.isObstacle(adjCol, adjRow)) {
						hasAdjacentObstacle = true;
						break;
					}
				}
				if (distance <= 0) continue;
				/** 计算排斥力 */
				const dirX: number = dx / distance;
				const dirY: number = dy / distance;
				let force: number = Math.max(0, (aVo.obstacleSafeDist - distance) / aVo.obstacleSafeDist) * 0.9;
				/** 相邻障碍物增强排斥力 */
				if (hasAdjacentObstacle) {
					force *= this.ADJACENT_OBSTACLE_FORCE_MULTIPLIER;
				}
				repulseX += dirX * force;
				repulseY += dirY * force;
			}
		}

		/** 限制最大障碍物排斥力 */
		const repulseLength: number = Math.sqrt(repulseX * repulseX + repulseY * repulseY);
		if (repulseLength > this.OBSTACLE_REPULSE_MAX) {
			const ratio: number = this.OBSTACLE_REPULSE_MAX / repulseLength;
			repulseX *= ratio;
			repulseY *= ratio;
		}

		aVo.targetObstacleForceX = repulseX;
		aVo.targetObstacleForceY = repulseY;
	}

	/** 
	 * 排斥力平滑插值
	 * @param aVo 敌人数据对象
	 * @param factor 插值因子（0-1）
	 */
	private smoothLerpCancelForce(aVo: AgentVo, factor: number): void {
		if (!aVo) return;
		aVo.smoothCancelForceX = aVo.smoothCancelForceX + (aVo.targetCancelForceX - aVo.smoothCancelForceX) * factor;
		aVo.smoothCancelForceY = aVo.smoothCancelForceY + (aVo.targetCancelForceY - aVo.smoothCancelForceY) * factor;
	}

	/** 
	 * 障碍物排斥力平滑插值
	 * @param aVo 敌人数据对象
	 * @param factor 插值因子（0-1）
	 */
	private smoothLerpObstacleForce(aVo: AgentVo, factor: number): void {
		if (!aVo) return;
		aVo.smoothObstacleForceX = aVo.smoothObstacleForceX + (aVo.targetObstacleForceX - aVo.smoothObstacleForceX) * factor;
		aVo.smoothObstacleForceY = aVo.smoothObstacleForceY + (aVo.targetObstacleForceY - aVo.smoothObstacleForceY) * factor;
	}

	/** 
	 * 速度平滑插值
	 * @param aVo 敌人数据对象
	 * @param factor 插值因子（0-1）
	 */
	private smoothLerpVelocity(aVo: AgentVo, factor: number): void {
		if (!aVo) return;
		aVo.smoothVelocityX = aVo.smoothVelocityX + (aVo.currentVelocityX - aVo.smoothVelocityX) * factor;
		aVo.smoothVelocityY = aVo.smoothVelocityY + (aVo.currentVelocityY - aVo.smoothVelocityY) * factor;
	}

	/** 
	 * 角度平滑过渡
	 * @param current 当前角度
	 * @param target 目标角度
	 * @returns 插值后的角度
	 */
	private smoothRotate(curRot: number, targetRot: number): number {
		let diff: number = targetRot - curRot;
		diff = ((diff + 540) % 360) - 180;
		return curRot + diff * 0.2;
	}

	/** 
	 * 合并所有力并应用
	 * 核心逻辑：
	 * 1. 按权重合并流场力、排斥力、障碍物力、对齐力
	 * 2. 限制最大力和最大速度
	 * 3. 平滑插值速度
	 * @param aVo 敌人数据对象
	 */
	private mergeAndApplyForce(aVo: AgentVo): void {
		if (!aVo) return;
		const flowForceX: number = aVo.calcForceX;
		const flowForceY: number = aVo.calcForceY;
		const cancelForceX: number = -aVo.smoothCancelForceX;
		const cancelForceY: number = -aVo.smoothCancelForceY;
		const obstacleForceX: number = aVo.smoothObstacleForceX;
		const obstacleForceY: number = aVo.smoothObstacleForceY;

		const alignForce: { x: number, y: number } = this.calculateAlignmentForce(aVo);

		/** 按权重合并所有力 */
		let finalForceX: number = flowForceX * this.FLOW_FIELD_WEIGHT
			+ cancelForceX * this.SEPARATE_WEIGHT
			+ obstacleForceX * this.OBSTACLE_AVOID_WEIGHT
			+ alignForce.x * this.ALIGN_WEIGHT;

		let finalForceY: number = flowForceY * this.FLOW_FIELD_WEIGHT
			+ cancelForceY * this.SEPARATE_WEIGHT
			+ obstacleForceY * this.OBSTACLE_AVOID_WEIGHT
			+ alignForce.y * this.ALIGN_WEIGHT;

		/** 限制最大力 */
		const forceLength: number = Math.sqrt(finalForceX * finalForceX + finalForceY * finalForceY);
		if (forceLength > aVo.maxForce) {
			const ratio: number = aVo.maxForce / forceLength;
			finalForceX *= ratio;
			finalForceY *= ratio;
		}

		/** 应用力到速度 */
		aVo.currentVelocityX += finalForceX;
		aVo.currentVelocityY += finalForceY;

		/** 限制最大速度 */
		const speedLength: number = Math.sqrt(aVo.currentVelocityX * aVo.currentVelocityX + aVo.currentVelocityY * aVo.currentVelocityY);
		if (speedLength > aVo.calcSpeed) {
			const ratio: number = aVo.calcSpeed / speedLength;
			aVo.currentVelocityX *= ratio;
			aVo.currentVelocityY *= ratio;
		}

		/** 平滑插值速度 */
		this.smoothLerpVelocity(aVo, this.SMOOTH_FACTOR * 1.2);

		/** 更新位置 */
		aVo.x += aVo.smoothVelocityX;
		aVo.y += aVo.smoothVelocityY;
	}

	/** 
	 * 速度方向约束
	 * 作用：调整速度方向，避免碰撞敌人和障碍物
	 * @param agentVo 敌人数据对象
	 */
	private limitVelocityToAvoidOverlapAndObstacle(aVo: AgentVo): void {
		if (!aVo) return;
		let hasOverlapAgent: boolean = false;
		let hasNearObstacle: boolean = false;
		let avoidDirX: number = 0;
		let avoidDirY: number = 0;
		const agentX: number = aVo.x;
		const agentY: number = aVo.y;
		const gridSize: number = this.gff.GRID_SIZE;

		/** 检测附近敌人 */
		const col: number = Math.floor(agentX / gridSize);
		const row: number = Math.floor(agentY / gridSize);
		const nearbyIds: number[] = this.getNearbyAgentIds(col, row);
		const nearbyLen: number = nearbyIds.length;
		for (let i: number = 0; i < nearbyLen; i++) {
			const otherId: number = nearbyIds[i];
			if (aVo.id === otherId) continue;
			const otherVo = this.getAgentVoById(otherId)
			const dx: number = otherVo.x - agentX;
			const dy: number = otherVo.y - agentY;
			const distance: number = Math.sqrt(dx * dx + dy * dy);
			const combinedRadius: number = aVo.radius + otherVo.radius;
			if (distance < combinedRadius && distance > 0) {
				hasOverlapAgent = true;
				avoidDirX += (agentX - otherVo.x) / distance;
				avoidDirY += (agentY - otherVo.y) / distance;
			}
		}
		/** 检测附近障碍物 */
		const sceneCol: number = Math.floor(agentX / gridSize);
		const sceneRow: number = Math.floor(agentY / gridSize);
		for (let dCol: number = -1; dCol <= 1; dCol++) {
			for (let dRow: number = -1; dRow <= 1; dRow++) {
				const checkCol: number = sceneCol + dCol;
				const checkRow: number = sceneRow + dRow;
				if (!this.gff.isObstacle(checkCol, checkRow)) continue;
				const obsSceneCol: number = checkCol;
				const obsSceneRow: number = checkRow;
				const obsLeft: number = obsSceneCol * gridSize;
				const obsRight: number = obsSceneCol * gridSize + gridSize;
				const obsTop: number = obsSceneRow * gridSize;
				const obsBottom: number = obsSceneRow * gridSize + gridSize;
				let closestX: number = Math.max(obsLeft, Math.min(agentX, obsRight));
				let closestY: number = Math.max(obsTop, Math.min(agentY, obsBottom));
				const dx: number = agentX - closestX;
				const dy: number = agentY - closestY;
				const distance: number = Math.sqrt(dx * dx + dy * dy);
				if (distance < aVo.obstacleSafeDist && distance > 0) {
					hasNearObstacle = true;
					avoidDirX += dx / distance * 1.2;
					avoidDirY += dy / distance * 1.2;
				}
			}
		}
		/** 混合原始方向和规避方向 */
		if (hasOverlapAgent || hasNearObstacle) {
			const avoidLength: number = Math.sqrt(avoidDirX * avoidDirX + avoidDirY * avoidDirY);
			if (avoidLength > 0) {
				avoidDirX /= avoidLength;
				avoidDirY /= avoidLength;
			}
			const velLength: number = Math.sqrt(aVo.currentVelocityX * aVo.currentVelocityX + aVo.currentVelocityY * aVo.currentVelocityY);
			const origDirX: number = aVo.currentVelocityX / (velLength || 1);
			const origDirY: number = aVo.currentVelocityY / (velLength || 1);
			const mixDirX: number = origDirX * (this.FLOW_FIELD_WEIGHT - 0.05) + avoidDirX * (this.OBSTACLE_AVOID_WEIGHT + 0.05);
			const mixDirY: number = origDirY * (this.FLOW_FIELD_WEIGHT - 0.05) + avoidDirY * (this.OBSTACLE_AVOID_WEIGHT + 0.05);
			aVo.currentVelocityX = mixDirX * velLength;
			aVo.currentVelocityY = mixDirY * velLength;
		}
	}

	/** 
	 * 敌人位置硬约束
	 * 作用：强制矫正重叠的敌人位置
	 * @param aVo 敌人数据对象
	 * @param index 敌人索引
	 */
	private correctOverlapPositionSmooth(aVo: AgentVo): void {
		if (!aVo) return;
		let correctX: number = 0;
		let correctY: number = 0;
		const agentX: number = aVo.x;
		const agentY: number = aVo.y;

		/** 获取附近敌人 */
		const col: number = Math.floor(agentX / this.gff.GRID_SIZE);
		const row: number = Math.floor(agentY / this.gff.GRID_SIZE);
		const nearbyIds: number[] = this.getNearbyAgentIds(col, row);

		/** 遍历附近敌人计算平均速度 */
		const nearbyLen: number = nearbyIds.length;
		for (let i = 0; i < nearbyLen; i++) {
			const otherId: number = nearbyIds[i];
			if (aVo.id === otherId) continue;
			const otherVo: AgentVo = this.getAgentVoById(otherId);

			let dx: number = otherVo.x - agentX;
			let dy: number = otherVo.y - agentY;
			if (dx == 0 && dy == 0) {
				dx = (Math.random() - 0.5) * 0.01;
				dy = (Math.random() - 0.5) * 0.01;
			}
			const distance: number = Math.sqrt(dx * dx + dy * dy);
			const overlapDelta: number = otherVo.radius + aVo.radius - distance;

			/** 硬约束阈值 = 自身半径 * 0.1（原逻辑），也可以改为 (自身半径 + 对方半径) * 系数 */
			const hardConstraintThreshold: number = aVo.radius * 0.1;
			/** 仅矫正超过阈值的重叠 */
			if (overlapDelta > hardConstraintThreshold && distance > 0) {
				let dirX: number = (agentX - otherVo.x) / distance;
				let dirY: number = (agentY - otherVo.y) / distance;
				if (dirX == 0 && dirY == 0) {
					dirX = (Math.random() - 0.5) * 0.01;
					dirY = (Math.random() - 0.5) * 0.01;
				}
				const offset: number = overlapDelta * this.CORRECT_ATTENUATION;
				correctX += dirX * offset;
				correctY += dirY * offset;
			}
		}

		/** 应用位置矫正 */
		if (Math.abs(correctX) > 0 || Math.abs(correctY) > 0) {
			aVo.x += correctX;
			aVo.y += correctY;
		}
	}

	/** 
	 * 障碍物位置硬矫正
	 * 作用：强制将敌人推出障碍物
	 * @param aVo 敌人数据对象
	 */
	private correctObstacleOverlapSmooth(aVo: AgentVo): void {
		if (!aVo) return;
		let correctX: number = 0;
		let correctY: number = 0;
		const agentX: number = aVo.x;
		const agentY: number = aVo.y;
		const gridSize: number = this.gff.GRID_SIZE;
		/** 转换为场景网格坐标 */
		const sceneCol: number = Math.floor(agentX / gridSize);
		const sceneRow: number = Math.floor(agentY / gridSize);
		const obstacleCorrectThreshold: number = aVo.radius * this.OBSTACLE_CORRECT_FACTOR;
		/** 检测附近障碍物 */
		for (let dCol: number = -1; dCol <= 1; dCol++) {
			for (let dRow: number = -1; dRow <= 1; dRow++) {
				const checkCol: number = sceneCol + dCol;
				const checkRow: number = sceneRow + dRow;
				if (!this.gff.isObstacle(checkCol, checkRow)) continue;
				/** 计算障碍物边界 */
				const obsLeft: number = checkCol * gridSize;
				const obsRight: number = checkCol * gridSize + gridSize;
				const obsTop: number = checkRow * gridSize;
				const obsBottom: number = checkRow * gridSize + gridSize;
				/** 计算最近点 */
				let closestX: number = Math.max(obsLeft, Math.min(agentX, obsRight));
				let closestY: number = Math.max(obsTop, Math.min(agentY, obsBottom));
				let dx: number = agentX - closestX;
				let dy: number = agentY - closestY;
				if (dx == 0 && dy == 0) {
					dx = (Math.random() - 0.5) * 0.01;
					dy = (Math.random() - 0.5) * 0.01;
				}
				const distance: number = Math.sqrt(dx * dx + dy * dy);
				const overlapDelta: number = aVo.radius - distance;
				/** 仅矫正超过阈值的重叠 */
				if (overlapDelta > obstacleCorrectThreshold && distance > 0) {
					const dirX: number = dx / distance;
					const dirY: number = dy / distance;
					const offset: number = overlapDelta * this.CORRECT_ATTENUATION * 1.0;
					correctX += dirX * offset;
					correctY += dirY * offset;
				}
			}
		}
		/** 应用位置矫正 */
		if (Math.abs(correctX) > 0 || Math.abs(correctY) > 0) {
			aVo.x += correctX;
			aVo.y += correctY;
		}
	}

	/** 
	 * 计算对齐力（Boid核心）
	 * 作用：让敌人朝向附近同伴的平均速度方向
	 * @param agentVo 敌人数据对象
	 * @returns 对齐力 {x, y}
	 */
	private calculateAlignmentForce(aVo: AgentVo): { x: number, y: number } {
		if (!aVo) return null;
		let avgVelX: number = 0;
		let avgVelY: number = 0;
		let neighborCount: number = 0;
		const selfX: number = aVo.x;
		const selfY: number = aVo.y;
		/** 获取当前网格 */
		const col: number = Math.floor(selfX / this.gff.GRID_SIZE);
		const row: number = Math.floor(selfY / this.gff.GRID_SIZE);
		const nearbyIds: number[] = this.getNearbyAgentIds(col, row);

		/** 遍历附近敌人计算平均速度 */
		const nearbyLen: number = nearbyIds.length;
		for (let i = 0; i < nearbyLen; i++) {
			const otherId: number = nearbyIds[i];
			if (aVo.id === otherId) continue;
			const otherVo: AgentVo = this.getAgentVoById(otherId);
			const dx: number = otherVo.x - selfX;
			const dy: number = otherVo.y - selfY;
			const distSq: number = dx * dx + dy * dy;
			/** 3. 核心修改：用「当前敌人半径 + 其他敌人半径」替代固定的 SAFE_DISTANCE*2 */
			/** 假设AgentVo中已定义 radius 属性（敌人自身半径） */
			const combinedRadius: number = aVo.radius + otherVo.radius;
			/**直接平方 不用根号distSq了 */
			const combinedRadiusSq: number = combinedRadius * combinedRadius;
			/** 4. 距离判断：超过半径之和则跳过（无需纳入平均速度计算） */
			if (distSq > combinedRadiusSq) continue;
			avgVelX += otherVo.smoothVelocityX;
			avgVelY += otherVo.smoothVelocityY;
			neighborCount++;
		}
		if (neighborCount === 0) return { x: 0, y: 0 };
		/** 计算平均速度并归一化 */
		avgVelX /= neighborCount;
		avgVelY /= neighborCount;
		const len: number = Math.sqrt(avgVelX * avgVelX + avgVelY * avgVelY);
		if (len > 0) {
			avgVelX = (avgVelX / len) * aVo.maxSpeed;
			avgVelY = (avgVelY / len) * aVo.maxSpeed;
		}
		/** 返回对齐力（目标速度 - 当前速度） */
		return {
			x: avgVelX - aVo.smoothVelocityX,
			y: avgVelY - aVo.smoothVelocityY
		};
	}

	/**
	 * 封装平滑转向逻辑：计算敌人朝向全局目标的平滑旋转角度
	 * @param aVo 敌人数据对象（包含当前位置、当前旋转角度）
	 * @param targetX 全局目标X坐标
	 * @param targetY 全局目标Y坐标
	 */
	private calculateSmoothRotation(aVo: AgentVo): void {
		if (!aVo) return;
		if (this.isTargetInvalid()) return;
		/** 1. 计算到目标的方向向量 */
		const dirX: number = this.gff.targetX - aVo.x;
		const dirY: number = this.gff.targetY - aVo.y;
		/** 2. 计算向量长度（避免除以0） */
		const dirLength: number = Math.sqrt(dirX * dirX + dirY * dirY);

		/** 3. 长度为0时，返回当前旋转角度（无需转向） */
		if (dirLength <= 0) return

		/** 4. 归一化方向向量 */
		const normDirX: number = dirX / dirLength;
		const normDirY: number = dirY / dirLength;
		/** 5. 计算目标旋转角度（弧度转角度） */
		const targetRotation: number = Math.atan2(normDirY, normDirX) * 180 / Math.PI;
		/** 6. 平滑旋转并返回结果 */
		aVo.rotation = this.smoothRotate(aVo.rotation, targetRotation);
	}

	/**
	 * 场景边界约束：限制敌人位置在场景宽高范围内
	 * @param aVo 敌人数据对象
	 * @param sceneWidth 场景宽度
	 * @param sceneHeight 场景高度
	 */
	private limitAgentToSceneBounds(aVo: AgentVo): void {
		if (!aVo) return;
		/** 从gff中获取场景宽高（假设GridFlowField已定义SCENE_WIDTH/SCENE_HEIGHT，若没有可改为传入参数） */
		const sceneWidth: number = this.gff.stageWidth;
		const sceneHeight: number = this.gff.stageHeight;

		/** 考虑敌人自身半径，避免敌人一半超出场景 */
		const halfRadius: number = aVo.radius || 0;

		/** X轴边界约束：左边界（>=0+半径）、右边界（<=场景宽度-半径） */
		aVo.x = Math.max(halfRadius, Math.min(aVo.x, sceneWidth - halfRadius));
		/** Y轴边界约束：上边界（>=0+半径）、下边界（<=场景高度-半径） */
		aVo.y = Math.max(halfRadius, Math.min(aVo.y, sceneHeight - halfRadius));

		/** 额外优化：如果敌人速度导致超出边界，重置对应方向的速度（避免持续顶边界） */
		if (aVo.x <= halfRadius) {
			aVo.currentVelocityX = Math.abs(aVo.currentVelocityX); /** 强制向右 */
			aVo.smoothVelocityX = Math.abs(aVo.smoothVelocityX);
		} else if (aVo.x >= sceneWidth - halfRadius) {
			aVo.currentVelocityX = -Math.abs(aVo.currentVelocityX); /** 强制向左 */
			aVo.smoothVelocityX = -Math.abs(aVo.smoothVelocityX);
		}

		if (aVo.y <= halfRadius) {
			aVo.currentVelocityY = Math.abs(aVo.currentVelocityY); /** 强制向下 */
			aVo.smoothVelocityY = Math.abs(aVo.smoothVelocityY);
		} else if (aVo.y >= sceneHeight - halfRadius) {
			aVo.currentVelocityY = -Math.abs(aVo.currentVelocityY); /** 强制向上 */
			aVo.smoothVelocityY = -Math.abs(aVo.smoothVelocityY);
		}
	}

	/** 根据ID获取敌人数据对象 */
	private getAgentVoById(agentId: number): AgentVo {
		if (!this._agents) return null;
		for (let i: number = 0; i < this._agents.length; i++) {
			let aVo: AgentVo = this._agents[i];
			if (aVo.id == agentId) return aVo;
		}
		return null;
	}

	/**
	 * 封装：校验目标是否无效（提取原有if的所有条件）
	 * @returns true=目标无效（需退出），false=目标有效（可继续执行）
	 */
	private isTargetInvalid(): boolean {
		/** 原有所有校验条件，逻辑完全不变 */
		return (
			this.gff.targetCol === -1 ||
			this.gff.targetRow === -1 ||
			isNaN(this.gff.targetX) ||
			isNaN(this.gff.targetY)
		);
	}

	public get agents(): ReadonlyArray<AgentVo> {
		return this._agents;
	}


	/** 销毁所有资源 - 内存优化：彻底释放所有引用 */
	public destroy(): void {
		if (this._agents) this._agents.length = 0;
		this._agents = null;
		this.agentGridMap = null;
		this.nearbyIdsMap = null;
		if (this.nearbyIds) this.nearbyIds.length = 0;
		this.nearbyIds = null;
		this.gff = null;
	}
}