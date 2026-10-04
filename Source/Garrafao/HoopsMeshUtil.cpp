#include "HoopsMeshUtil.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Actor.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"

const FHoopsBasicShapes& FHoopsBasicShapes::Get()
{
	static FHoopsBasicShapes Shapes;
	static bool bLoaded = false;
	if (!bLoaded)
	{
		bLoaded = true;
		Shapes.Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
		Shapes.Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
		Shapes.Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
		Shapes.BaseMaterial = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));

		UObject* ToRoot[] = {Shapes.Cube, Shapes.Cylinder, Shapes.Sphere, Shapes.BaseMaterial};
		for (UObject* Object : ToRoot)
		{
			if (Object)
			{
				Object->AddToRoot();
			}
		}
	}
	return Shapes;
}

namespace HoopsMeshUtil
{
	void SetColor(UObject* Outer, UStaticMeshComponent* Component, const FLinearColor& Color)
	{
		const FHoopsBasicShapes& Shapes = FHoopsBasicShapes::Get();
		if (!Component || !Shapes.BaseMaterial)
		{
			return;
		}
		UMaterialInstanceDynamic* Material = UMaterialInstanceDynamic::Create(Shapes.BaseMaterial, Outer);
		Material->SetVectorParameterValue(TEXT("Color"), Color);
		Component->SetMaterial(0, Material);
	}

	UStaticMeshComponent* AddMesh(AActor* Owner, USceneComponent* Parent, UStaticMesh* Mesh,
		const FTransform& RelativeTransform, const FLinearColor& Color, bool bCollision)
	{
		if (!Owner || !Mesh)
		{
			return nullptr;
		}

		UStaticMeshComponent* Component = NewObject<UStaticMeshComponent>(Owner);
		Component->SetStaticMesh(Mesh);
		Component->SetupAttachment(Parent ? Parent : Owner->GetRootComponent());
		Component->SetRelativeTransform(RelativeTransform);
		Component->SetCollisionEnabled(bCollision ? ECollisionEnabled::QueryAndPhysics : ECollisionEnabled::NoCollision);
		if (bCollision)
		{
			Component->SetCollisionProfileName(TEXT("BlockAll"));
		}
		Component->SetCanEverAffectNavigation(false);
		Component->RegisterComponent();
		Owner->AddInstanceComponent(Component);
		SetColor(Owner, Component, Color);
		return Component;
	}

	UStaticMeshComponent* AddStrip(AActor* Owner, USceneComponent* Parent, const FVector2D& A, const FVector2D& B,
		float Width, float Thickness, float ZCenter, const FLinearColor& Color)
	{
		const FVector2D Delta = B - A;
		const float Length = static_cast<float>(Delta.Size()) + Width; // cobre as juntas
		const FVector2D Mid = (A + B) * 0.5;
		const float Yaw = FMath::RadiansToDegrees(FMath::Atan2(static_cast<float>(Delta.Y), static_cast<float>(Delta.X)));

		const FTransform Transform(
			FRotator(0.0f, Yaw, 0.0f),
			FVector(Mid.X, Mid.Y, ZCenter),
			FVector(Length / 100.0f, Width / 100.0f, Thickness / 100.0f));
		return AddMesh(Owner, Parent, FHoopsBasicShapes::Get().Cube, Transform, Color, false);
	}

	UStaticMeshComponent* AddRod(AActor* Owner, USceneComponent* Parent, const FVector& A, const FVector& B,
		float Diameter, const FLinearColor& Color)
	{
		const FVector Delta = B - A;
		const float Length = static_cast<float>(Delta.Size());
		if (Length < UE_KINDA_SMALL_NUMBER)
		{
			return nullptr;
		}
		const FRotator Rotation = FRotationMatrix::MakeFromZ(Delta / Length).Rotator();
		const FTransform Transform(Rotation, (A + B) * 0.5, FVector(Diameter / 100.0f, Diameter / 100.0f, Length / 100.0f));
		return AddMesh(Owner, Parent, FHoopsBasicShapes::Get().Cylinder, Transform, Color, false);
	}
}
